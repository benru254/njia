/** How recording is switched on, and the power-saving settings. Stored on the phone. */
import { getMeta, setMeta } from './db';

/** manual = Start / Stop buttons. always = records by itself all the time, one recording per day. */
export type RecordMode = 'manual' | 'always';

export async function getRecordMode(): Promise<RecordMode> {
  return (await getMeta('record_mode')) === 'always' ? 'always' : 'manual';
}

export async function setRecordMode(mode: RecordMode): Promise<void> {
  await setMeta('record_mode', mode);
}

export const STILL_CHECK_CHOICES = [
  { seconds: 30, label: 'Every 30 seconds', hint: 'Notices you leaving sooner. A little more battery.' },
  { seconds: 60, label: 'Every minute', hint: 'Recommended.' },
  { seconds: 120, label: 'Every 2 minutes', hint: 'Most saving. Without a motion sensor, a trip may start up to 2 minutes late.' },
];

export async function getStillCheckS(): Promise<number> {
  const v = Number(await getMeta('still_check_s'));
  return STILL_CHECK_CHOICES.some((c) => c.seconds === v) ? v : 60;
}

export async function setStillCheckS(seconds: number): Promise<void> {
  await setMeta('still_check_s', String(seconds));
}
