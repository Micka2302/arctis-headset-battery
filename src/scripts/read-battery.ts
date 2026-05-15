import {
  closeSteelSeriesBatteryDevice,
  DeviceFilter,
  getSteelSeriesBatteryDevice,
  isHeadsetChargingViaUSB,
  readBatteryLevel
} from '../steelseries-battery';

async function main() {
  try {
    const filterArg = process.argv.find(arg => arg.startsWith('--device='));
    const requestedFilter = filterArg?.split('=')[1];
    const filter: DeviceFilter = requestedFilter === 'headset' || requestedFilter === 'mouse'
      ? requestedFilter
      : 'auto';

    const isChargingViaUSB = isHeadsetChargingViaUSB(true);
    const device = await getSteelSeriesBatteryDevice(true, filter);

    if (!device) {
      console.log('Could not connect to a supported SteelSeries battery device');
      process.exit(1);
    }

    const batteryStatus = await readBatteryLevel(device);

    console.log(`Device: ${device.name} (${device.model})`);
    console.log(`Type: ${device.kind}`);

    if (batteryStatus?.percentage !== null && batteryStatus?.percentage !== undefined) {
      console.log(`Battery Level: ${batteryStatus.percentage}%`);
    } else {
      console.log('Battery Level: Unknown');
    }

    if (batteryStatus?.isCharging !== null && batteryStatus?.isCharging !== undefined) {
      console.log(`Charging: ${batteryStatus.isCharging ? 'Yes' : 'No'}`);
    } else if (device.kind === 'headset') {
      console.log(`Charging via USB: ${isChargingViaUSB ? 'Yes' : 'No'} (detected by USB device presence)`);
    } else {
      console.log('Charging: Unknown');
    }

    if (batteryStatus?.rawResponse.length) {
      console.log('Full response:', Buffer.from(batteryStatus.rawResponse));

      console.log('\nDetailed response analysis:');
      batteryStatus.rawResponse.forEach((byte, index) => {
        console.log(`Byte ${index}: ${byte} (0x${byte.toString(16).padStart(2, '0')})`);
      });
    }

    closeSteelSeriesBatteryDevice(device);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

const isMainModule = import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  main();
}
