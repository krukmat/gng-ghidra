/** Live run length is independent of the frozen AOT certificate horizon.
 * Immutable private program/runtime remain unchanged. The existing CPU
 * records frames in RAM, hence live sessions stay bounded and restartable.
 */
export const LIVE_FRAMES=6000;
export const MAX_LIVE_FRAMES=12000;
export function validateLiveFrames(manifest,requested=LIVE_FRAMES){
  if(!manifest||!Number.isSafeInteger(manifest.frames)||
     manifest.frames<600||manifest.frames>MAX_LIVE_FRAMES||
     !Number.isSafeInteger(manifest.blocks)||
     manifest.blocks<1||manifest.blocks>30000)
    throw Error('V3_B2C_UNVERIFIED_BUNDLE');
  if(!Number.isSafeInteger(requested)||requested<manifest.frames||
     requested>MAX_LIVE_FRAMES)
    throw Error('V3_B2C_SESSION_FRAMES_INVALID');
  return requested;
}
