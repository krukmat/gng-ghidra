/** One active-low joystick port as the game must read it, frame by frame.
 * The page reports every change of its fingers in milliseconds, but the game
 * reads once per frame and the frames run in bursts, so several changes can
 * arrive between two reads. Each press is therefore kept until a frame has
 * shown it, and the game's own timing rules (the caller's numbers) are met
 * by waiting, never by dropping:
 *   frames          pressed frames of each press, at least;
 *   every           frames between two press edges of a button; a press that
 *                   comes sooner waits its turn (one waits, more merge);
 *   afterDirection  frames a new direction is read before the button's edge;
 *   repeat          while held, the button presses again every `every`.
 * Bits outside `directions` and `buttons` pass through. Pure: no timers.
 */
export function createInputShaper({idle=0xff,directions=0,directionFrames=1,buttons=[]}={}){
  const chans=buttons.map(b=>({bit:b.bit,frames:Math.max(1,b.frames??1),
    every:b.every??0,afterDirection:b.afterDirection??0,repeat:false,
    raw:false,pending:0,show:0,out:false,since:Infinity}));
  const shaped=chans.reduce((m,c)=>m|c.bit,directions);
  let raw=idle,tap=0,tapLeft=0,dirOut=0,dirAge=Infinity,active=false;
  return {
    /** False until the page has reported once. */
    get active(){return active;},
    /** The fingers as last reported. */
    get raw(){return raw;},
    setRepeat(bit,on){for(const c of chans)if(c.bit===bit)c.repeat=!!on;},
    /** The page's value, in order: every change, also between frames. */
    push(value){
      active=true;
      const pressed=raw&~value&directions;
      if(pressed){tap=pressed;tapLeft=directionFrames;}
      for(const c of chans){
        const now=!(value&c.bit);
        if(now&&!c.raw)c.pending=1;
        c.raw=now;
      }
      raw=value;
    },
    /** The value the game reads during the next frame. */
    frame(){
      // A direction tapped and released between two frames still shows.
      let held=~raw&directions;
      if(!held&&tapLeft>0)held=tap;
      if(tapLeft>0)tapLeft--;
      dirAge=held&~dirOut?0:dirAge+1;dirOut=held;
      let out=(raw|shaped)&~held;
      for(const c of chans){
        c.since++;
        if(c.show>0)c.show--;
        else{
          if(c.repeat&&c.out&&c.raw&&!c.pending&&c.since>=c.every-1)c.pending=1;
          if(c.pending){
            if(c.out)c.out=false; // a released frame makes the next edge
            else if(c.since>=c.every&&dirAge>=c.afterDirection){
              c.pending=0;c.out=true;c.show=c.frames-1;c.since=0;
            }
          }else if(!c.raw)c.out=false;
        }
        if(c.out)out&=~c.bit;
      }
      return out&0xff;
    },
  };
}
