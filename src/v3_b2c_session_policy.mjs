/** Live run length is independent of the frozen AOT certificate horizon.
 * Immutable private program/runtime remain unchanged. The live worker
 * drops each frame snapshot once delivered (V3.B3), so a session is no
 * longer memory-bound; it stays finite (~10 min) and restartable.
 */
export const LIVE_FRAMES=36000;
export const MAX_LIVE_FRAMES=216000;
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
