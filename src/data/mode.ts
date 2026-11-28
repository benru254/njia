/** How recording is switched on. Stored on the phone. */
import { getMeta, setMeta } from './db';

/** manual = Start / Stop buttons. always = records by itself all the time, one recording per day. */
export type RecordMode = 'manual' | 'always';

export async function getRecordMode(): Promise<RecordMode> {
  return (await getMeta('record_mode')) === 'always' ? 'always' : 'manual';
}

export async function setRecordMode(mode: RecordMode): Promise<void> {
  await setMeta('record_mode', mode);
}
