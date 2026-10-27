-- H3 pasos 1-2: registrador de entradas de gngb (laboratorio; salida privada).
-- En cada notificador de frame (VBLANK start, ya hecho el sondeo de entradas
-- de MAME) anota los puertos 0x3000-0x3004 y un hash de la RAM principal:
-- "F <frame> <frame_number> <5 bytes> <hash>". Un tap comprueba que toda
-- lectura de la CPU hasta el siguiente notificador devuelve el byte anotado
-- ("V <frame> <addr> <leido> <anotado>" si no).
-- Rebobinado: K guarda estado y L vuelve al último guardado; tras la carga
-- se anota "R <frame>" (se descartan los frames >= frame), así la cinta sigue
-- siendo desde reset. Una carga ajena (p. ej. F7 de MAME) anota "X".
-- Prueba sin humano: GNG_H3_TAPE inyecta una cinta con el convenio calibrado
-- de v3_b3_oracle.lua (shift -1); GNG_H3_SAVE_AT/GNG_H3_LOAD_AT simulan K/L y
-- GNG_H3_TAPE2 sustituye a la cinta tras la carga.
local dir = assert(os.getenv("GNG_H3_DIR"), "H3_DIR_MISSING")
local last = tonumber(os.getenv("GNG_H3_FRAMES") or "0")
local save_at = tonumber(os.getenv("GNG_H3_SAVE_AT") or "0")
local load_at = tonumber(os.getenv("GNG_H3_LOAD_AT") or "0")
local machine = manager.machine
assert(machine.system and machine.system.name == "gngb", "H3_NOT_GNGB")
local screen = assert(machine.screens[":screen"], "H3_SCREEN")
local space = assert(machine.devices[":maincpu"].spaces["program"], "H3_SPACE")
local input = machine.input
local KEY_SAVE, KEY_LOAD = input:code_from_token("KEYCODE_K"), input:code_from_token("KEYCODE_L")
local ports = {}
for i, tag in ipairs({":SYSTEM", ":P1", ":P2", ":DSW1", ":DSW2"}) do
    ports[i] = assert(machine.ioport.ports[tag], "H3_PORT_" .. tag)
end
local FIELDS = {
    coin1 = {":SYSTEM", "Coin 1"}, start1 = {":SYSTEM", "1 Player Start"},
    ["p1.right"] = {":P1", "P1 Right"}, ["p1.left"] = {":P1", "P1 Left"},
    ["p1.up"] = {":P1", "P1 Up"}, ["p1.down"] = {":P1", "P1 Down"},
    ["p1.button1"] = {":P1", "P1 Button 1"}, ["p1.button2"] = {":P1", "P1 Button 2"},
}
local fields = {}
for name, spec in pairs(FIELDS) do
    fields[name] = assert(machine.ioport.ports[spec[1]].fields[spec[2]], "H3_FIELD_" .. spec[2])
end
local function schedule(spec)
    local events = {}
    for f, c, p in (spec or ""):gmatch("(%d+):([%w%.]+):([01])") do
        local at = tonumber(f) - 1
        local list = events[at] or {}
        list[#list + 1] = {assert(fields[c], "H3_CONTROL_" .. c), tonumber(p)}
        events[at] = list
    end
    return events
end
local events, events2 = schedule(os.getenv("GNG_H3_TAPE")), schedule(os.getenv("GNG_H3_TAPE2"))
local out = assert(io.open(dir .. "/journal.txt", "w"), "H3_OPEN")
local function snapshot()
    local s = space:read_range(0x0000, 0x1dff, 8)
    local h = 0xcbf29ce484222325
    for i = 1, #s, 8 do h = (h ~ string.unpack("<i8", s, i)) * 0x100000001b3 end
    local b = {}
    for i = 1, 5 do b[i] = ports[i]:read() end
    return b, h
end
local count, logged, base, lastfn, done, reads, fixes = 0, 0, nil, nil, false, 0, 0
local saved, pending, loaded, keys, hist = nil, nil, false, {}, {}
local cur, hash = snapshot()
hist[0] = cur
local function write(fn)
    out:write(string.format("F %d %d %02x %02x %02x %02x %02x %016x\n", count, fn,
        cur[1], cur[2], cur[3], cur[4], cur[5], hash))
end
write(screen:frame_number())
h3_tap = space:install_read_tap(0x3000, 0x3004, "h3-inputs", function(offset, data, mask)
    if pending and screen:frame_number() < lastfn then
        -- carga hecha: el resto del frame guardado debe leer lo anotado entonces
        count, cur, pending, loaded = pending, hist[pending], nil, true
    end
    local want = cur[offset - 0x2fff]
    reads = reads + 1
    if loaded and data ~= want then
        -- MAME no restaura las entradas al cargar: el resto del frame guardado
        -- recibe lo anotado entonces, como en el camino original.
        fixes = fixes + 1
        return want
    end
    if data ~= want then
        out:write(string.format("V %d %04x %02x %02x\n", count, offset, data, want))
    end
    return data
end)
local function finish()
    if done then return end
    done = true
    out:write("E\n")
    out:close()
    print("H3_RECORDER=DONE frames=" .. count .. " cpu_input_reads=" .. reads .. " post_load_fixes=" .. fixes)
end
local function edge(name, code)
    local down = input:code_pressed(code)
    local hit = down and not keys[name]
    keys[name] = down
    return hit
end
h3_stop = emu.add_machine_stop_notifier(finish)
h3_sub = emu.add_machine_frame_notifier(function()
    local fn = screen:frame_number()
    if fn == lastfn then return end -- UI en pausa: no avanza la emulación
    base = base or fn - 1
    lastfn, count = fn, fn - base
    if count <= logged then
        out:write(string.format("%s %d\n", (loaded or pending) and "R" or "X", count))
    end
    loaded, pending = false, nil
    cur, hash = snapshot()
    hist[count] = cur
    write(fn)
    logged = count
    for _, ev in ipairs(events[count] or {}) do ev[1]:set_value(ev[2]) end
    if count == save_at or edge("save", KEY_SAVE) then
        machine:save("h3")
        saved = count
        machine:popmessage("H3: estado guardado en frame " .. count)
    end
    if saved and (count == load_at or edge("load", KEY_LOAD)) then
        machine:load("h3")
        pending, load_at = saved, 0 -- la carga guionizada ocurre una sola vez
        for _, f in pairs(fields) do f:set_value(0) end
        events = events2
        machine:popmessage("H3: vuelta al frame " .. saved)
    end
    if last > 0 and count >= last then
        finish()
        machine:exit()
    end
end)
