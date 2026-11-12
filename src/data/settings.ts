/** Your trip settings, stored on the phone. */
import { DEST_MIN_CHOICES } from '../core/segment';
import { DEFAULT_SETTINGS, TRAVEL_MODES, TravelMode, TripSettings } from '../core/types';
import { getMeta, setMeta } from './db';

const DEST_KEY = 'dest_min_s';
const VEHICLE_KEY = 'vehicle';

export async function getSettings(): Promise<TripSettings> {
  const [dest, vehicle] = await Promise.all([getMeta(DEST_KEY), getMeta(VEHICLE_KEY)]);
  const d = Number(dest);
  return {
    destMinS: DEST_MIN_CHOICES.includes(d) ? d : DEFAULT_SETTINGS.destMinS,
    vehicle: TRAVEL_MODES.includes(vehicle as TravelMode) && vehicle !== 'walk' ? (vehicle as TravelMode) : DEFAULT_SETTINGS.vehicle,
  };
}

export async function setDestMinS(seconds: number): Promise<void> {
  if (!DEST_MIN_CHOICES.includes(seconds)) return;
  await setMeta(DEST_KEY, String(seconds));
}

export async function setVehicle(mode: TravelMode): Promise<void> {
  await setMeta(VEHICLE_KEY, mode);
}
