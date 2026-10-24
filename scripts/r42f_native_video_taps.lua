-- R4.2.F optional, private MAME write-tap timeline recorder.
-- Imported by capture-mame-frame.lua ONLY when GNG_R42F_TIMELINE=1.
-- Uses documented Lua APIs: install_write_tap, screen.frame_number,
-- machine.time:as_double. No raster/IRQ/MC6809 PC correlation is claimed.
-- Records chronological callback order, not an instruction-ordered trace.
return function(ctx)
    local dir, space, screen, machine = ctx.dir,ctx.space,ctx.screen,ctx.machine
    local run_id = assert(os.getenv("GNG_R42F_RUN_ID"), "R42F_RUN_ID_REQUIRED")
    assert(run_id:match("^[0-9a-f]+$") and #run_id == 32,"R42F_RUN_ID_INVALID")
    local max = tonumber(os.getenv("GNG_R42F_MAX_EVENTS") or "1000000")
    assert(max and max % 1 == 0 and max >= 1 and max <= 1000000,
           "R42F_EVENT_LIMIT_INVALID")
    local trace = assert(io.open(dir .. "/r42f-native-events.jsonl","wb"),
                         "R42F_TIMELINE_FILE_UNWRITABLE")
    local seq,last_frame,last_time,writes,dmas,finished=0,-1,-1,0,0,false
    local function frame_number()
        local value=screen.frame_number
        if type(value)=="number" then return value end
        if type(value)=="function" then return screen:frame_number() end
        error("R42F_FRAME_NUMBER_API_UNAVAILABLE")
    end
    local function record(kind,address,data,mask)
        assert(not finished,"R42F_RECORD_AFTER_FINISH")
        assert(seq < max,"R42F_EVENT_LIMIT_REACHED_ABORT_NO_COMPLETE_META")
        local frame=assert(frame_number(),"R42F_FRAME_UNAVAILABLE")
        local time=assert(machine.time:as_double(),"R42F_MACHINE_TIME_UNAVAILABLE")
        assert(type(frame)=="number" and frame%1==0 and frame>=last_frame,
               "R42F_FRAME_NONMONOTONIC")
        assert(type(time)=="number" and time>=last_time and time==time,
               "R42F_TIME_NONMONOTONIC")
        if kind~="CHECKPOINT" then
            assert(type(address)=="number" and address%1==0
                   and type(data)=="number" and data%1==0 and data>=0
                   and data<=255 and type(mask)=="number" and mask==255,
                   "R42F_NON_8BIT_TAP_REJECTED")
        end
        local fields
        if kind=="CHECKPOINT" then
            fields=string.format('"address":null,"data":null,"mask":null')
        else
            fields=string.format('"address":%d,"data":%d,"mask":%d',
                                 address,data,mask)
        end
        local line=string.format(
            '{"seq":%d,"kind":"%s","frame":%d,"emu_seconds":%.12f,'..
            '"raster_vpos":null,"raster_hpos":null,"%s":true,%s}\n',
            seq,kind,frame,time,"raster_unobserved",fields)
        assert(trace:write(line),"R42F_TRACE_WRITE_FAILED")
        seq=seq+1;last_frame=frame;last_time=time
        if kind=="WRITE8" then writes=writes+1 end
        if kind=="DMA" then dmas=dmas+1 end
    end
    local handlers={}
    local function tap(lo,hi,name)
        return assert(space:install_write_tap(lo,hi,name,
            function(address,data,mask)
                if not finished then record("WRITE8",address,data,mask) end
                return data -- mandatory pass-through
            end), "R42F_TAP_INSTALL_FAILED_" .. name)
    end
    -- Existing R0 script already owns the scroll and 0x3c00 taps.
    -- Do NOT add second taps on those ranges.
    handlers[1]=tap(0x1e00,0x2fff,"r42f-cpu-sprite-fg-bg")
    handlers[2]=tap(0x3800,0x39ff,"r42f-palette")
    local function scroll_tap(address,data,mask)
        if not finished then record("WRITE8",address,data,mask) end
    end
    local function dma_tap(address,data,mask)
        if not finished then record("DMA",address,data,mask) end
    end
    local function finish(frame)
        assert(not finished,"R42F_DUPLICATE_FINISH")
        assert(frame==frame_number(),"R42F_CHECKPOINT_FRAME_CHANGED")
        assert(dmas>0,"R42F_NATIVE_DMA_REQUIRED")
        record("CHECKPOINT",nil,nil,nil)
        assert(trace:flush(),"R42F_TRACE_FLUSH_FAILED")
        assert(trace:close(),"R42F_TRACE_CLOSE_FAILED")
        finished=true
        local metadata=string.format(
            '{"schema":"gng.r42f.native-video-metadata.v1",'..
            '"run_id":"%s","driver":"%s","target_frame":%d,'..
            '"last_frame":%d,"event_count":%d,"write_count":%d,'..
            '"dma_count":%d,"checkpoint_count":1,'..
            '"coverage":"POST_AUTOBOOT_TAP_INSTALL_ONLY",'..
            '"raster_precision":"UNAVAILABLE_LUA_DOCUMENTED_API",'..
            '"instruction_alignment_verified":false,'..
            '"native_vblank_alignment_verified":false}\n',
            run_id,ctx.driver,ctx.target,frame,seq,writes,dmas)
        local m=assert(io.open(dir .. "/r42f-native-metadata.json","wb"),
                       "R42F_METADATA_UNWRITABLE")
        assert(m:write(metadata) and m:close(),"R42F_METADATA_WRITE_FAILED")
        print("GNG_R42F_TIMELINE=CAPTURED events=" .. seq .. " dma=" .. dmas)
    end
    return {scroll_tap=scroll_tap,dma_tap=dma_tap,finish=finish,
            handles=handlers}
end
