/** Wire visually grounded crossing decisions to existing P1 input commands.
 * The caller owns GET /pixels observation, POST /input dispatch, and reset.
 * Never derives state from privileged memory or performs HTTP itself.
 */
import {createWaterCrossingPolicy} from './water-crossing.mjs';
import {createWaterPortAdapter} from '../control/water-ports.mjs';
export function createWaterController(calibration){
  const policy=createWaterCrossingPolicy(calibration);
  const ports=createWaterPortAdapter();
  function step(observation){
    const decision=policy.observe(observation);
    const {commands,status}=ports.step({session:observation.session,
      phase:decision.phase,action:decision.action});
    return {...decision,commands,portStatus:status};
  }
  function reset(){policy.reset();return ports.reset();}
  return {step,reset};
}
