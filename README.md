# SteelSeries Battery - Stream Deck Plugin

Stream Deck plugin for displaying the battery level of supported SteelSeries wireless headsets and mice.

The plugin was originally built for Arctis headsets and now also supports Arctis Nova 7 Gen 2 Wireless and Aerox 5 Wireless.

![SteelSeries Battery Plugin](com.0xjessel.arctis-headset-battery.sdPlugin/imgs/plugin/marketplace.png)

## Features

- Displays battery percentage for supported SteelSeries devices.
- Supports headsets and mice from the same action.
- Device filter: auto, headsets only, mice only.
- Dynamic battery icon shared by headset and mouse actions.
- Custom text overlay with variables such as `{battery}`, `{charging}`, `{model}`, and `{device}`.
- Text customization: position, size, color, outline, opacity, font, weight, italic, alignment, rotation, and letter spacing.
- Configurable polling interval from 1 to 60 seconds.
- Manual refresh by pressing the Stream Deck key.
- Keeps the last known battery percentage during short wireless read failures.
- Fast retry after transient HID disconnects.

## Supported Devices

| Device | Type | Vendor ID | Product ID | Status |
| --- | --- | --- | --- | --- |
| SteelSeries Arctis 7 2019 | Headset | `0x1038` | `0x12ad` | Supported |
| SteelSeries Arctis 7 2017 | Headset | `0x1038` | `0x1260` | Supported in code |
| SteelSeries Arctis Pro | Headset | `0x1038` | `0x1294` | Supported in code |
| SteelSeries Arctis 1 Wireless | Headset | `0x1038` | `0x12b3` | Supported in code |
| SteelSeries Arctis Nova 7 Gen 2 Wireless | Headset | `0x1038` | `0x227e` | Verified |
| SteelSeries Aerox 5 Wireless, wired mode | Mouse | `0x1038` | `0x1854` | Supported |
| SteelSeries Aerox 5 Wireless, 2.4 GHz wireless mode | Mouse | `0x1038` | `0x1852` | Verified |

## Requirements

- Stream Deck 6.4 or newer.
- Node.js 20.5.1 or newer for development/building.
- Windows 10+ or macOS 12+ as declared in the plugin manifest.
- `node-hid` native dependency available in the installed plugin folder when running through Stream Deck.

## Usage

1. Add the `Battery Level` action to your Stream Deck.
2. Choose the target device mode:
   - `Auto`
   - `Headsets only`
   - `Mice only`
3. Set the polling interval. The default is 5 seconds, and the minimum is 1 second.
4. Press the key to force an immediate refresh.
5. Enable `Dynamic battery icon` to render the battery image directly on the key.

Battery updates are polling-based, not a real-time stream. Some SteelSeries devices do not update their HID battery value every second, even if the plugin polls quickly.

## Custom Text

Use `Custom Text` to draw text directly inside the generated icon. If the field is empty, the plugin only uses the Stream Deck title unless `Percent Position` is set to a non-title mode.

Available variables:

| Variable | Meaning | Example |
| --- | --- | --- |
| `{battery}` | Current battery percentage | `90%` |
| `{charging}` | Charging symbol when charging | lightning symbol |
| `{model}` | Detected device model | `Arctis Nova 7 Gen 2 Wireless` |
| `{device}` | Device kind | `headset` or `mouse` |

Common setup:

```text
Custom Text: {battery}
Text X: 72
Text Y: 122
Text Size: 24
```

Text options include:

- X/Y position
- size
- color
- outline color
- outline width
- opacity
- font
- font weight
- italic
- alignment
- rotation
- letter spacing

## Install And Build

Install dependencies:

```powershell
npm install
```

If PowerShell blocks `npm.ps1`, use:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
```

Build the plugin:

```powershell
npm run build
```

Or with the direct Windows npm command:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run build
```

Validate the plugin:

```powershell
npm exec streamdeck -- validate com.0xjessel.arctis-headset-battery.sdPlugin
```

## Development Commands

```powershell
npm run build
npm run watch
npm run read:battery
npm run read:battery -- --device=headset
npm run read:battery -- --device=mouse
```

On Windows, if `npm` is not available in PowerShell:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run read:battery -- --device=headset
& "C:\Program Files\nodejs\npm.cmd" run read:battery -- --device=mouse
```

## Testing Device Reads

You can test battery reading without Stream Deck:

```powershell
npm run read:battery
```

Filter by device type:

```powershell
npm run read:battery -- --device=headset
npm run read:battery -- --device=mouse
```

The script scans SteelSeries HID devices, lists matching interfaces, connects to the preferred battery interface, and prints:

- detected device name
- device type
- battery level
- charging state when available
- raw HID response bytes

## Stream Deck Development Install

Enable Stream Deck developer mode:

```powershell
npm exec streamdeck -- dev
```

Link the plugin during development:

```powershell
npm exec streamdeck -- link com.0xjessel.arctis-headset-battery.sdPlugin
```

Restart the plugin:

```powershell
npm exec streamdeck -- restart com.0xjessel.arctis-headset-battery
```

If the plugin is already installed and not linked, copy the built plugin files into:

```text
%APPDATA%\Elgato\StreamDeck\Plugins\com.0xjessel.arctis-headset-battery.sdPlugin
```

Because `node-hid` is a native dependency and is external in the Rollup build, make sure it exists in the installed plugin folder:

```powershell
$installed = Resolve-Path "$env:APPDATA\Elgato\StreamDeck\Plugins\com.0xjessel.arctis-headset-battery.sdPlugin"
& "C:\Program Files\nodejs\npm.cmd" install --omit=dev --prefix $installed.Path node-hid@3.1.2
```

## Current HID Protocol Notes

### Legacy Arctis

Legacy Arctis devices use:

```text
Command: [0x06, 0x18]
Battery byte: response[2]
```

The plugin caps valid percentage values at 100.

### Arctis Nova 7 Gen 2 Wireless

Nova 7 Gen 2 uses:

```text
Command: [0x00, 0xb0]
Expected response byte 0: 0xb0
Battery byte: response[2]
Charging byte: response[3]
```

Battery can be reported either as a direct percentage or as a 0-4 scale depending on firmware/device behavior. Charging is interpreted as:

- `1`: charging
- `3`: discharging
- other values: unknown

### Aerox 5 Wireless

Aerox 5 uses different commands depending on mode:

```text
Wired mode: [0x00, 0x92]
2.4 GHz wireless mode: [0x00, 0xd2]
Battery byte: response[1]
```

The high bit indicates charging. The lower bits are interpreted as a 5 percent bucket scale.

For Aerox devices, the plugin filters to the preferred battery HID interface:

```text
Interface: 3
Usage: 1
UsagePage: 65472
```

## Polling Behavior

The plugin reads battery state by polling HID devices:

- default interval: 5 seconds
- configurable range: 1-60 seconds
- manual refresh: press the Stream Deck key
- fast retry: 1 second after a short read failure
- no overlapping HID reads

Wireless devices can briefly disappear from HID enumeration. During short failures, the plugin keeps the last known percentage instead of immediately clearing the display.

## Troubleshooting

### The key does not update immediately

Battery data comes from HID polling. Lower the polling interval or press the key to force a refresh. Some devices update their battery value slowly at the hardware/firmware level.

### The key shows the wrong device

Use `Device Type` and choose `Headsets only` or `Mice only`. This prevents auto mode from selecting the other supported device.

### The percentage disappears briefly

Short wireless disconnects are expected with some devices. The plugin keeps the last known value during short failures and retries quickly.

### The property inspector does not show new options

Click another action and then return to the battery action, or restart the Stream Deck app.

### PowerShell blocks npm

Use `npm.cmd` directly:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run build
```

## License

[MIT](LICENSE)
