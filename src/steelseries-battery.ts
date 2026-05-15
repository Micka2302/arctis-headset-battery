import HID from 'node-hid';

HID.setDriverType('libusb');

export const STEELSERIES_VENDOR_ID = 0x1038;

const ARCTIS_7_BOOTLOADER_PRODUCT_ID = 0x12ae;
const AEROX_BATTERY_CHARGING_FLAG = 0b10000000;

export type DeviceKind = 'headset' | 'mouse';
export type DeviceFilter = DeviceKind | 'auto';

export type BatteryProtocol = 'arctisLegacy' | 'arctisNova' | 'aerox5Wired' | 'aerox5Wireless';

export interface DeviceSpec {
  vendorId: number;
  productId: number;
  model: string;
  kind: DeviceKind;
  protocol: BatteryProtocol;
  preferredUsage?: number;
  preferredUsagePage?: number;
  preferredInterface?: number;
  preferredProductUsagePage?: number;
}

export interface SteelSeriesBatteryDevice {
  device: HID.HID;
  info: HID.Device;
  name: string;
  model: string;
  kind: DeviceKind;
  spec: DeviceSpec;
}

export interface BatteryReading {
  percentage: number | null;
  isCharging: boolean | null;
  isConnected: boolean;
  rawResponse: number[];
}

export interface BatteryStatus {
  device: Omit<SteelSeriesBatteryDevice, 'device'>;
  reading: BatteryReading;
}

export const SUPPORTED_DEVICES: DeviceSpec[] = [
  {
    vendorId: STEELSERIES_VENDOR_ID,
    productId: 0x12ad,
    model: 'Arctis 7 2019',
    kind: 'headset',
    protocol: 'arctisLegacy',
    preferredUsage: 514,
    preferredUsagePage: 65347
  },
  {
    vendorId: STEELSERIES_VENDOR_ID,
    productId: 0x1260,
    model: 'Arctis 7 2017',
    kind: 'headset',
    protocol: 'arctisLegacy',
    preferredUsage: 514,
    preferredUsagePage: 65347
  },
  {
    vendorId: STEELSERIES_VENDOR_ID,
    productId: 0x1294,
    model: 'Arctis Pro',
    kind: 'headset',
    protocol: 'arctisLegacy',
    preferredUsage: 514,
    preferredUsagePage: 65347
  },
  {
    vendorId: STEELSERIES_VENDOR_ID,
    productId: 0x12b3,
    model: 'Arctis 1 Wireless',
    kind: 'headset',
    protocol: 'arctisLegacy',
    preferredUsage: 514,
    preferredUsagePage: 65347
  },
  {
    vendorId: STEELSERIES_VENDOR_ID,
    productId: 0x227e,
    model: 'Arctis Nova 7 Gen 2 Wireless',
    kind: 'headset',
    protocol: 'arctisNova',
    preferredInterface: 3
  },
  {
    vendorId: STEELSERIES_VENDOR_ID,
    productId: 0x1854,
    model: 'Aerox 5 Wireless (wired mode)',
    kind: 'mouse',
    protocol: 'aerox5Wired',
    preferredInterface: 3,
    preferredProductUsagePage: 65472
  },
  {
    vendorId: STEELSERIES_VENDOR_ID,
    productId: 0x1852,
    model: 'Aerox 5 Wireless (2.4 GHz wireless mode)',
    kind: 'mouse',
    protocol: 'aerox5Wireless',
    preferredInterface: 3,
    preferredProductUsagePage: 65472
  }
];

function formatHex(value?: number): string {
  return typeof value === 'number' ? `0x${value.toString(16)}` : 'unknown';
}

function getDeviceInterface(device: HID.Device): number | undefined {
  return (device as HID.Device & { interface?: number }).interface;
}

function getDeviceSpec(device: HID.Device): DeviceSpec | undefined {
  return SUPPORTED_DEVICES.find(spec => (
    device.vendorId === spec.vendorId &&
    device.productId === spec.productId
  ));
}

function isSteelSeriesDevice(device: HID.Device): boolean {
  return device.vendorId === STEELSERIES_VENDOR_ID ||
    Boolean(device.manufacturer?.includes('SteelSeries'));
}

function matchesFilter(spec: DeviceSpec, filter: DeviceFilter): boolean {
  return filter === 'auto' || spec.kind === filter;
}

function getPriority(device: HID.Device, spec: DeviceSpec): number {
  let priority = SUPPORTED_DEVICES.indexOf(spec) * 10;

  if (
    spec.preferredUsage !== undefined &&
    spec.preferredUsagePage !== undefined &&
    device.usage === spec.preferredUsage &&
    device.usagePage === spec.preferredUsagePage
  ) {
    priority -= 1000;
  }

  if (
    spec.preferredInterface !== undefined &&
    getDeviceInterface(device) === spec.preferredInterface
  ) {
    priority -= 500;
  }

  if (
    spec.preferredProductUsagePage !== undefined &&
    device.usagePage === spec.preferredProductUsagePage
  ) {
    priority -= 500;
  }

  return priority;
}

function canReadBatteryFromDeviceInfo(device: HID.Device, spec: DeviceSpec): boolean {
  if (spec.kind !== 'mouse') {
    return true;
  }

  return getDeviceInterface(device) === spec.preferredInterface &&
    device.usage === 1 &&
    device.usagePage === spec.preferredProductUsagePage;
}

function describeDevice(device: HID.Device): string {
  return [
    `VendorID: ${formatHex(device.vendorId)}`,
    `ProductID: ${formatHex(device.productId)}`,
    `Product: ${device.product ?? 'unknown'}`,
    `Usage: ${device.usage ?? 'unknown'}`,
    `UsagePage: ${device.usagePage ?? 'unknown'}`,
    `Interface: ${getDeviceInterface(device) ?? 'unknown'}`,
    `Path: ${device.path ?? 'unknown'}`
  ].join('\n  ');
}

export function listSupportedSteelSeriesDevices(filter: DeviceFilter = 'auto'): Array<{ device: HID.Device; spec: DeviceSpec }> {
  return HID.devices()
    .filter(isSteelSeriesDevice)
    .map(device => ({ device, spec: getDeviceSpec(device) }))
    .filter((item): item is { device: HID.Device; spec: DeviceSpec } => (
      item.spec !== undefined &&
      matchesFilter(item.spec, filter) &&
      canReadBatteryFromDeviceInfo(item.device, item.spec)
    ))
    .sort((a, b) => getPriority(a.device, a.spec) - getPriority(b.device, b.spec));
}

export function logSupportedSteelSeriesDevices(filter: DeviceFilter = 'auto'): void {
  const devices = listSupportedSteelSeriesDevices(filter);

  if (devices.length === 0) {
    console.log('No supported SteelSeries battery device found');
    return;
  }

  console.log('Found supported SteelSeries battery devices:');
  devices.forEach(({ device, spec }, index) => {
    console.log(`Device ${index + 1}: ${spec.model}`);
    console.log(`  ${describeDevice(device)}`);
  });
}

export function isHeadsetChargingViaUSB(verbose = false): boolean {
  try {
    const steelSeriesDevices = HID.devices().filter(device => (
      isSteelSeriesDevice(device) && device.vendorId === STEELSERIES_VENDOR_ID
    ));

    if (verbose && steelSeriesDevices.length > 0) {
      console.log('Found SteelSeries devices:');
      steelSeriesDevices.forEach((device, index) => {
        console.log(`Device ${index + 1}:`);
        console.log(`  ${describeDevice(device)}`);
      });
    }

    const bootloaderDevices = steelSeriesDevices.filter(device => (
      device.productId === ARCTIS_7_BOOTLOADER_PRODUCT_ID &&
      Boolean(device.product?.includes('Bootloader'))
    ));

    if (verbose) {
      console.log(`Found ${bootloaderDevices.length} Arctis 7 Bootloader devices`);
      console.log(`Headset charging via USB: ${bootloaderDevices.length > 0}`);
    }

    return bootloaderDevices.length > 0;
  } catch (error) {
    console.error('Error checking if headset is charging via USB:', error);
    return false;
  }
}

function writeAndRead(device: HID.HID, command: number[], timeoutMs = 1000): number[] | null {
  device.write(command);
  const response = device.readTimeout(timeoutMs);
  return response ? Array.from(response) : null;
}

function padReport(command: number[], reportLength: number): number[] {
  if (command.length >= reportLength) {
    return command;
  }

  return [...command, ...Array(reportLength - command.length).fill(0)];
}

function tryWriteAndRead(device: HID.HID, command: number[], timeoutMs = 1000): number[] | null {
  try {
    return writeAndRead(device, command, timeoutMs);
  } catch {
    return null;
  }
}

function trySendFeatureReportAndRead(device: HID.HID, command: number[], timeoutMs = 1000): number[] | null {
  try {
    device.sendFeatureReport(command);
    const response = device.readTimeout(timeoutMs);
    return response ? Array.from(response) : null;
  } catch {
    return null;
  }
}

function readLegacyArctisBattery(device: HID.HID): BatteryReading | null {
  const response = writeAndRead(device, [0x06, 0x18]);

  if (!response || response.length < 3) {
    return null;
  }

  const rawPercentage = response[2];

  return {
    percentage: rawPercentage > 0 ? Math.min(rawPercentage, 100) : null,
    isCharging: null,
    isConnected: rawPercentage > 0,
    rawResponse: response
  };
}

function readNovaArctisBattery(device: HID.HID): BatteryReading | null {
  const response = writeAndRead(device, [0x00, 0xb0]);

  if (!response || response.length < 4 || response[0] !== 0xb0) {
    return null;
  }

  const rawBatteryLevel = response[2];
  const rawChargingState = response[3];
  const percentage = rawBatteryLevel <= 4 ? rawBatteryLevel * 25 : rawBatteryLevel;

  return {
    percentage: percentage > 0 ? Math.min(percentage, 100) : null,
    isCharging: rawChargingState === 1 ? true : rawChargingState === 3 ? false : null,
    isConnected: rawBatteryLevel > 0,
    rawResponse: response
  };
}

function readAerox5Battery(device: HID.HID, protocol: 'aerox5Wired' | 'aerox5Wireless'): BatteryReading | null {
  const command = protocol === 'aerox5Wireless' ? 0xd2 : 0x92;
  const report = [0x00, command];
  const paddedReport = padReport(report, 65);
  const response =
    tryWriteAndRead(device, report, 200) ??
    tryWriteAndRead(device, paddedReport, 200) ??
    trySendFeatureReportAndRead(device, report, 200) ??
    trySendFeatureReportAndRead(device, paddedReport, 200);

  if (!response || response.length < 2) {
    return null;
  }

  const rawBattery = response[1];
  const rawBatteryLevel = rawBattery & ~AEROX_BATTERY_CHARGING_FLAG;
  const percentage = (rawBatteryLevel - 1) * 5;

  return {
    percentage: percentage >= 0 && percentage <= 100 ? percentage : null,
    isCharging: Boolean(rawBattery & AEROX_BATTERY_CHARGING_FLAG),
    isConnected: percentage >= 0 && percentage <= 100,
    rawResponse: response
  };
}

export async function readBatteryLevel(device: SteelSeriesBatteryDevice): Promise<BatteryReading | null> {
  if (device.spec.protocol === 'arctisLegacy') {
    return readLegacyArctisBattery(device.device);
  }

  if (device.spec.protocol === 'arctisNova') {
    return readNovaArctisBattery(device.device);
  }

  return readAerox5Battery(device.device, device.spec.protocol);
}

export async function getSteelSeriesBatteryDevice(
  verbose = false,
  filter: DeviceFilter = 'auto'
): Promise<SteelSeriesBatteryDevice | null> {
  try {
    const candidates = listSupportedSteelSeriesDevices(filter);

    if (verbose) {
      logSupportedSteelSeriesDevices(filter);
    }

    for (const { device: deviceInfo, spec } of candidates) {
      if (!deviceInfo.path) {
        continue;
      }

      let hidDevice: HID.HID | undefined;

      try {
        hidDevice = new HID.HID(deviceInfo.path);
        const batteryDevice: SteelSeriesBatteryDevice = {
          device: hidDevice,
          info: deviceInfo,
          name: deviceInfo.product?.replace('SteelSeries ', '') || spec.model,
          model: spec.model,
          kind: spec.kind,
          spec
        };
        const reading = await readBatteryLevel(batteryDevice);

        if (reading?.isConnected) {
          if (verbose) {
            console.log(`Successfully connected to ${batteryDevice.name} (${batteryDevice.model})`);
            console.log(`VendorID: ${formatHex(deviceInfo.vendorId)}, ProductID: ${formatHex(deviceInfo.productId)}`);
          }

          return batteryDevice;
        }

        hidDevice.close();
      } catch (error) {
        try {
          hidDevice?.close();
        } catch {
          // The open/read attempt already failed; there is nothing useful to report here.
        }

        if (verbose) {
          console.error(`Error connecting to ${spec.model}:`, error);
        }
      }
    }

    if (verbose) {
      console.log('Could not find a working SteelSeries battery interface');
    }

    return null;
  } catch (error) {
    if (verbose) {
      console.error('Error finding SteelSeries battery device:', error);
    }

    return null;
  }
}

export async function readFirstSupportedBatteryStatus(
  filter: DeviceFilter = 'auto',
  verbose = false
): Promise<BatteryStatus | null> {
  const batteryDevice = await getSteelSeriesBatteryDevice(verbose, filter);

  if (!batteryDevice) {
    return null;
  }

  try {
    const reading = await readBatteryLevel(batteryDevice);

    if (!reading?.isConnected) {
      return null;
    }

    const { device: _device, ...device } = batteryDevice;
    return { device, reading };
  } finally {
    closeSteelSeriesBatteryDevice(batteryDevice);
  }
}

export function closeSteelSeriesBatteryDevice(device: SteelSeriesBatteryDevice): void {
  try {
    device.device.close();
  } catch (error) {
    console.error('Error closing SteelSeries battery device:', error);
  }
}
