import {
  WillAppearEvent,
  WillDisappearEvent,
  KeyUpEvent,
  DidReceiveSettingsEvent,
  SingletonAction,
  JsonObject,
  streamDeck,
  action
} from '@elgato/streamdeck';
import HID from 'node-hid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import {
  DeviceFilter,
  DeviceKind,
  BatteryStatus,
  isHeadsetChargingViaUSB,
  readFirstSupportedBatteryStatus
} from '../steelseries-battery';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHARGING_ICON = '\u26a1';
const DEFAULT_POLLING_INTERVAL_SECONDS = 5;
const FAST_RETRY_DELAY_MS = 1000;

HID.setDriverType('libusb');

try {
  streamDeck.logger.debug('Testing HID initialization...', {
    __dirname,
    import_meta_url: import.meta.url
  });

  const nodeHid = require('node-hid');
  const testDevices = nodeHid.devices();
  streamDeck.logger.debug('HID initialization successful', { deviceCount: testDevices.length });
} catch (error) {
  streamDeck.logger.error('Error initializing HID:', {
    error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
}

interface BatteryState {
  percentage: number | null;
  isCharging: boolean;
  isConnected: boolean;
  model?: string;
  kind?: DeviceKind;
  error?: string;
}

interface Settings extends JsonObject {
  pollingInterval?: number;
  deviceType?: DeviceFilter;
  dynamicIcon?: boolean | string;
  percentPosition?: PercentPosition;
  customText?: string;
  customTextX?: number | string;
  customTextY?: number | string;
  customTextSize?: number | string;
  customTextColor?: string;
  customTextStrokeColor?: string;
  customTextStrokeWidth?: number | string;
  customTextOpacity?: number | string;
  customTextFont?: string;
  customTextWeight?: string;
  customTextAnchor?: string;
  customTextItalic?: boolean | string;
  customTextRotation?: number | string;
  customTextLetterSpacing?: number | string;
}

type PercentPosition = 'title' | 'top' | 'center' | 'bottom' | 'custom' | 'hidden';

interface ActionRuntime {
  currentState: BatteryState;
  failedReadCount?: number;
  lastEvent?: WillAppearEvent<Settings>;
  pollingInterval?: NodeJS.Timeout;
  updateInProgress?: boolean;
  updateRequested?: boolean;
  settings: Settings;
}

function createDisconnectedState(error?: unknown): BatteryState {
  return {
    percentage: null,
    isCharging: false,
    isConnected: false,
    model: undefined,
    kind: undefined,
    error: error instanceof Error ? error.message : error ? String(error) : undefined
  };
}

function getDeviceFilter(settings?: Settings): DeviceFilter {
  const configuredType = settings?.deviceType;
  return configuredType === 'headset' || configuredType === 'mouse' ? configuredType : 'auto';
}

function usesDynamicIcon(settings?: Settings): boolean {
  return settings?.dynamicIcon !== false && settings?.dynamicIcon !== 'false';
}

function getPollingIntervalMs(settings?: Settings): number {
  return clampNumber(settings?.pollingInterval, DEFAULT_POLLING_INTERVAL_SECONDS, 1, 60) * 1000;
}

function getPercentPosition(settings?: Settings): PercentPosition {
  const position = settings?.percentPosition;
  return position === 'top' || position === 'center' || position === 'bottom' || position === 'custom' || position === 'hidden'
    ? position
    : 'title';
}

function getTitleText(state: BatteryState): string {
  if (!state.isConnected) {
    if (state.percentage !== null) {
      return `${state.percentage}%${state.isCharging ? ` ${CHARGING_ICON}` : ''}`;
    }

    return state.error ? 'ERR' : state.isCharging ? CHARGING_ICON : '-';
  }

  return state.percentage === null
    ? '?'
    : `${state.percentage}%${state.isCharging ? ` ${CHARGING_ICON}` : ''}`;
}

function getBatteryColor(percentage: number | null): string {
  if (percentage === null) return '#6b7280';
  if (percentage <= 20) return '#ef4444';
  if (percentage <= 50) return '#f59e0b';
  return '#22c55e';
}

function toImageDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeSvgAttribute(value: string): string {
  return escapeSvgText(value).replace(/"/g, '&quot;');
}

function getSvgColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  if (/^#[0-9a-fA-F]{8}$/.test(value)) {
    return value.slice(0, 7);
  }

  return fallback;
}

function getTextFont(value: unknown): string {
  const fonts: Record<string, string> = {
    arial: 'Arial, sans-serif',
    segoe: '"Segoe UI", Arial, sans-serif',
    verdana: 'Verdana, Geneva, sans-serif',
    tahoma: 'Tahoma, Geneva, sans-serif',
    trebuchet: '"Trebuchet MS", Arial, sans-serif',
    georgia: 'Georgia, serif',
    impact: 'Impact, Haettenschweiler, sans-serif',
    monospace: '"Cascadia Mono", Consolas, monospace'
  };

  return typeof value === 'string' && fonts[value] ? fonts[value] : fonts.arial;
}

function getTextWeight(value: unknown): string {
  return typeof value === 'string' && /^(400|500|600|700|800|900)$/.test(value) ? value : '700';
}

function getTextAnchor(value: unknown): string {
  return value === 'start' || value === 'end' ? value : 'middle';
}

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

function getOverlayText(state: BatteryState, settings: Settings): string {
  const template = typeof settings.customText === 'string' ? settings.customText.trim() : '';
  const battery = state.percentage === null ? getTitleText(state) : `${state.percentage}%`;

  return template
    .replaceAll('{battery}', battery)
    .replaceAll('{charging}', state.isCharging ? CHARGING_ICON : '')
    .replaceAll('{model}', state.model ?? '')
    .replaceAll('{device}', state.kind ?? '');
}

function getTextOverlay(state: BatteryState, settings: Settings): string {
  const position = getPercentPosition(settings);
  const customText = getOverlayText(state, settings).trim();
  const hasCustomText = customText.length > 0;

  if (position === 'hidden' || (position === 'title' && !hasCustomText)) {
    return '';
  }

  const isCustom = position === 'custom' || hasCustomText;
  const x = isCustom ? clampNumber(settings.customTextX, 72, 0, 144) : 72;
  const y = isCustom
    ? clampNumber(settings.customTextY, 122, 0, 144)
    : position === 'top' ? 28 : position === 'center' ? 78 : 132;
  const fontSize = isCustom ? clampNumber(settings.customTextSize, 24, 10, 56) : 28;
  const strokeWidth = isCustom
    ? clampNumber(settings.customTextStrokeWidth, Math.max(3, Math.round(fontSize / 6)), 0, 14)
    : Math.max(3, Math.round(fontSize / 6));
  const fill = getSvgColor(settings.customTextColor, '#ffffff');
  const stroke = getSvgColor(settings.customTextStrokeColor, '#111827');
  const opacity = clampNumber(settings.customTextOpacity, 100, 0, 100) / 100;
  const fontFamily = escapeSvgAttribute(getTextFont(settings.customTextFont));
  const fontWeight = getTextWeight(settings.customTextWeight);
  const fontStyle = isEnabled(settings.customTextItalic) ? 'italic' : 'normal';
  const textAnchor = getTextAnchor(settings.customTextAnchor);
  const rotation = clampNumber(settings.customTextRotation, 0, -180, 180);
  const letterSpacing = clampNumber(settings.customTextLetterSpacing, 0, -5, 12);
  const text = escapeSvgText(hasCustomText ? customText : getTitleText(state));
  const baseAttributes = `x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})" text-anchor="${textAnchor}" dominant-baseline="middle" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" letter-spacing="${letterSpacing}" opacity="${opacity}"`;
  const outline = strokeWidth > 0
    ? `<text ${baseAttributes} fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round">${text}</text>`
    : '';
  const foreground = `<text ${baseAttributes} fill="${fill}" stroke="none">${text}</text>`;

  return `${outline}${foreground}`;
}

function getGenericBatteryIcon(state: BatteryState, color: string, percentage: number | null, settings: Settings): string {
  const fillWidth = percentage === null ? 0 : Math.max(4, Math.round(68 * percentage / 100));
  const opacity = state.isConnected ? 1 : 0.42;
  const fill = percentage === null
    ? ''
    : `<rect x="38" y="58" width="${fillWidth}" height="28" rx="7" fill="${color}"/>`;
  const chargingBolt = state.isCharging
    ? '<path d="M73 39 55 76h14l-8 31 29-43H75z" fill="#ffffff" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>'
    : '';
  const disconnectedSlash = !state.isConnected
    ? '<path d="M35 109 111 35" stroke="#ef4444" stroke-width="10" stroke-linecap="round"/>'
    : '';
  const textOverlay = getTextOverlay(state, settings);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="none"/>
  <g opacity="${opacity}">
    <rect x="28" y="49" width="84" height="46" rx="13" fill="#111827" stroke="#ffffff" stroke-width="7"/>
    <rect x="115" y="63" width="8" height="18" rx="4" fill="#ffffff"/>
    ${fill}
  </g>
  ${chargingBolt}
  ${disconnectedSlash}
  ${textOverlay}
</svg>`;
}

function getDynamicBatteryIcon(state: BatteryState, settings: Settings): string {
  const percentage = state.percentage;
  const color = getBatteryColor(percentage);
  const svg = getGenericBatteryIcon(state, color, percentage, settings);

  return toImageDataUri(svg);
}

@action({ UUID: 'com.0xjessel.steelserie-wireless-battery.battery-level' })
export class BatteryLevelAction extends SingletonAction<Settings> {
  private readonly runtimes = new Map<string, ActionRuntime>();
  private hidQueue: Promise<void> = Promise.resolve();

  override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Key pressed, forcing battery status update', {
      context: ev.action.id,
      settings: ev.payload.settings
    });

    const runtime = this.getRuntime(ev.action.id);
    runtime.settings = ev.payload.settings;
    await this.updateBatteryStatus(ev.action.id, ev);
  }

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Action appearing', {
      context: ev.action.id,
      settings: ev.payload.settings
    });

    const runtime = this.getRuntime(ev.action.id);
    runtime.lastEvent = ev;
    runtime.settings = ev.payload.settings;

    await this.updateUI(ev, runtime.currentState, runtime.settings);
    this.startPolling(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Settings updated', {
      context: ev.action.id,
      settings: ev.payload.settings
    });

    const runtime = this.getRuntime(ev.action.id);
    runtime.settings = ev.payload.settings;
    this.startPolling(ev.action.id);
  }

  override async onWillDisappear(ev: WillDisappearEvent<Settings>): Promise<void> {
    streamDeck.logger.info('Action disappearing', {
      context: ev.action.id
    });

    this.stopPolling(ev.action.id);
    this.runtimes.delete(ev.action.id);
  }

  private getRuntime(context: string): ActionRuntime {
    let runtime = this.runtimes.get(context);

    if (!runtime) {
      runtime = {
        currentState: createDisconnectedState(),
        settings: {}
      };
      this.runtimes.set(context, runtime);
    }

    return runtime;
  }

  private startPolling(context: string) {
    const runtime = this.getRuntime(context);
    const interval = getPollingIntervalMs(runtime.settings);
    streamDeck.logger.debug('Starting polling', { context, interval });
    this.stopPolling(context);
    this.scheduleNextPoll(context, 0);
  }

  private stopPolling(context: string) {
    const runtime = this.runtimes.get(context);

    if (runtime?.pollingInterval) {
      streamDeck.logger.debug('Stopping polling', { context });
      clearTimeout(runtime.pollingInterval);
      runtime.pollingInterval = undefined;
    }
  }

  private scheduleNextPoll(context: string, delayMs?: number) {
    const runtime = this.runtimes.get(context);

    if (!runtime) {
      return;
    }

    this.stopPolling(context);
    const interval = delayMs ?? getPollingIntervalMs(runtime.settings);
    runtime.pollingInterval = setTimeout(() => this.updateBatteryStatus(context), interval);
  }

  private readQueuedBatteryStatus(deviceFilter: DeviceFilter): Promise<BatteryStatus | null> {
    const read = this.hidQueue.then(() => readFirstSupportedBatteryStatus(deviceFilter));
    this.hidQueue = read.catch(() => undefined).then(() => undefined);
    return read;
  }

  private async updateBatteryStatus(
    context: string,
    ev?: WillAppearEvent<Settings> | KeyUpEvent<Settings>
  ) {
    const runtime = this.getRuntime(context);
    const deviceFilter = getDeviceFilter(runtime.settings);
    let nextPollDelay = getPollingIntervalMs(runtime.settings);

    if (runtime.updateInProgress) {
      runtime.updateRequested = true;
      streamDeck.logger.debug('Battery update already running, queueing immediate refresh', {
        context,
        deviceFilter
      });
      return;
    }

    runtime.updateInProgress = true;

    try {
      const status = await this.readQueuedBatteryStatus(deviceFilter);

      if (!status) {
        streamDeck.logger.info('No supported SteelSeries battery device connected', {
          context,
          deviceFilter
        });
        this.updateDisconnectedState(context, deviceFilter, undefined, ev);
        nextPollDelay = (runtime.failedReadCount ?? 0) <= 3
          ? FAST_RETRY_DELAY_MS
          : getPollingIntervalMs(runtime.settings);
        return;
      }

      runtime.failedReadCount = 0;
      runtime.currentState = {
        percentage: status.reading.percentage,
        isCharging: status.reading.isCharging ?? (status.device.kind === 'headset' ? isHeadsetChargingViaUSB() : false),
        isConnected: true,
        model: status.device.model,
        kind: status.device.kind,
        error: undefined
      };

      streamDeck.logger.debug('Battery status', {
        context,
        percentage: runtime.currentState.percentage,
        isCharging: runtime.currentState.isCharging,
        model: runtime.currentState.model,
        kind: runtime.currentState.kind,
        deviceFilter
      });

      await this.updateUI(ev ?? runtime.lastEvent, runtime.currentState, runtime.settings);
    } catch (error) {
      streamDeck.logger.error('Error updating battery status:', {
        context,
        error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      this.updateDisconnectedState(context, deviceFilter, error, ev);
      nextPollDelay = (runtime.failedReadCount ?? 0) <= 3
        ? FAST_RETRY_DELAY_MS
        : getPollingIntervalMs(runtime.settings);
    } finally {
      runtime.updateInProgress = false;

      if (!this.runtimes.has(context)) {
        return;
      }

      if (runtime.updateRequested) {
        runtime.updateRequested = false;
        this.scheduleNextPoll(context, 0);
        return;
      }

      this.scheduleNextPoll(context, nextPollDelay);
    }
  }

  private updateDisconnectedState(
    context: string,
    deviceFilter: DeviceFilter,
    error?: unknown,
    ev?: WillAppearEvent<Settings> | KeyUpEvent<Settings>
  ) {
    const runtime = this.getRuntime(context);
    const previousState = runtime.currentState;
    runtime.failedReadCount = (runtime.failedReadCount ?? 0) + 1;

    if (previousState.percentage !== null && runtime.failedReadCount <= 3) {
      streamDeck.logger.info('Keeping last known battery status after transient read failure', {
        context,
        deviceFilter,
        failedReadCount: runtime.failedReadCount,
        percentage: previousState.percentage,
        kind: previousState.kind
      });
      this.updateUI(ev ?? runtime.lastEvent, previousState, runtime.settings);
      return;
    }

    const canBeHeadset = deviceFilter === 'auto' || deviceFilter === 'headset';
    const isChargingViaUSB = canBeHeadset ? isHeadsetChargingViaUSB() : false;

    runtime.currentState = {
      ...createDisconnectedState(error),
      percentage: previousState.percentage,
      isCharging: isChargingViaUSB || previousState.isCharging,
      model: previousState.model,
      kind: previousState.kind
    };
    this.updateUI(ev ?? runtime.lastEvent, runtime.currentState, runtime.settings);
  }

  private async updateUI(
    ev: WillAppearEvent<Settings> | KeyUpEvent<Settings> | undefined,
    state: BatteryState,
    settings: Settings
  ) {
    if (!ev) {
      streamDeck.logger.warn('No event provided to updateUI, skipping update');
      return;
    }

    if (usesDynamicIcon(settings)) {
      await ev.action.setImage(getDynamicBatteryIcon(state, settings));
    } else {
      await ev.action.setImage();
    }

    const percentPosition = getPercentPosition(settings);
    const title = getTitleText(state);

    if (usesDynamicIcon(settings) && percentPosition !== 'title') {
      await ev.action.setTitle('');
      return;
    }

    await ev.action.setTitle(percentPosition === 'hidden' ? '' : title);
  }
}
