package org.rommigration.shell

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Secure Bluetooth Classic RFCOMM between two Android devices already paired
 * in Settings: one listens (host), the other connects (guest), and then both
 * exchange UTF-8 lines of at most MAX_LINE bytes. The page reaches it as
 * window.ShellBluetooth and hears it through window.__shellBluetooth(event):
 * {type:'status', role, state, detail, available} and {type:'line', line}.
 * What the lines mean is the page's business. Paired devices only: no
 * scanning, no location. After the Street Fighter 1987 consumer's
 * BluetoothPeer, without its video and control framing.
 */
internal class BluetoothLine(
    private val activity: Activity,
    private val browser: WebView
) {
    companion object {
        const val MAX_LINE = 65536
        const val REQUEST_PERMISSION = 7301
        private const val HELLO = "SHELL-LINE|1"
        private val ADDRESS = Regex("^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
    }
    // One service per application id: two different games never pair up.
    private val serviceUuid: UUID =
        UUID.nameUUIDFromBytes(("rom-migration-shell:" + activity.packageName).toByteArray())
    private val serviceName =
        activity.applicationInfo.loadLabel(activity.packageManager).toString()
    private val adapter: BluetoothAdapter? =
        activity.getSystemService(BluetoothManager::class.java)?.adapter
    private val generation = AtomicInteger(0)
    @Volatile private var queue = ArrayBlockingQueue<String>(1024)
    @Volatile private var role = "none"
    @Volatile private var state = "disconnected"
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var server: BluetoothServerSocket? = null

    private fun permitted() =
        Build.VERSION.SDK_INT < 31 ||
        activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED

    private fun statusJson(detail: String = "", stateOverride: String? = null) =
        JSONObject().put("type", "status").put("role", role)
            .put("state", stateOverride ?: state).put("detail", detail)
            .put("available", adapter != null).toString()

    private fun emit(payload: String, ticket: Int? = null) {
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed &&
                (ticket == null || generation.get() == ticket))
                browser.evaluateJavascript("window.__shellBluetooth?.($payload)", null)
        }
    }
    private fun transition(nextRole: String, nextState: String, detail: String = "") {
        role = nextRole
        state = nextState
        emit(statusJson(detail))
    }
    private fun closeTransport() {
        try { server?.close() } catch (_: IOException) {}
        try { socket?.close() } catch (_: IOException) {}
        server = null
        socket = null
        // An old writer keeps its own queue: it never takes a new session's lines.
        queue = ArrayBlockingQueue<String>(1024)
    }

    @JavascriptInterface fun available(): Boolean = adapter != null

    @JavascriptInterface fun status(): String = when {
        adapter == null -> statusJson(stateOverride = "unavailable")
        !permitted() -> statusJson(stateOverride = "permission-required")
        else -> statusJson()
    }

    @JavascriptInterface fun requestPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= 31 && adapter != null && !permitted()) {
            activity.runOnUiThread {
                activity.requestPermissions(
                    arrayOf(Manifest.permission.BLUETOOTH_CONNECT), REQUEST_PERMISSION)
            }
            return true
        }
        announcePermission()
        return false
    }

    fun announcePermission() {
        if (adapter == null) transition("none", "unavailable")
        else if (!permitted()) transition("none", "permission-required")
        else if (state == "permission-required") transition("none", "disconnected")
        else emit(statusJson())
    }

    @JavascriptInterface fun pairedDevices(): String {
        if (!permitted()) return "[]"
        return try {
            val items = JSONArray()
            for (device in adapter?.bondedDevices.orEmpty().sortedBy { it.name ?: "" }) {
                if (device.bondState != BluetoothDevice.BOND_BONDED) continue
                items.put(JSONObject().put("name", device.name ?: "Android")
                    .put("address", device.address))
            }
            items.toString()
        } catch (_: SecurityException) { "[]" }
    }

    private fun canStart(): Boolean {
        if (adapter == null) { transition("none", "unavailable"); return false }
        if (!permitted()) { transition("none", "permission-required"); return false }
        return try {
            if (!adapter.isEnabled) {
                transition("none", "error", "BLUETOOTH_OFF")
                false
            } else true
        } catch (_: SecurityException) {
            transition("none", "permission-required")
            false
        }
    }

    @JavascriptInterface @Synchronized fun host(): Boolean {
        if (!canStart()) return false
        val ticket = generation.incrementAndGet()
        closeTransport()
        transition("host", "waiting")
        Thread({
            try {
                val listener = adapter!!.listenUsingRfcommWithServiceRecord(
                    serviceName, serviceUuid)
                if (!adopt(ticket, listener) { server = it }) return@Thread
                val peer = listener.accept()
                if (!adopt(ticket, peer) { socket = it }) return@Thread
                listener.close()
                server = null
                val input = BufferedInputStream(peer.inputStream)
                if (readLine(input) != HELLO) throw IOException("BAD_HANDSHAKE")
                peer.outputStream.write((HELLO + "\n").toByteArray(Charsets.UTF_8))
                peer.outputStream.flush()
                exchange(ticket, peer, input, "host")
            } catch (_: SecurityException) { finish(ticket, true, permission = true)
            } catch (_: Exception) { finish(ticket, true) }
        }, "shell-bt-host").start()
        return true
    }

    @JavascriptInterface @Synchronized fun join(address: String): Boolean {
        if (!ADDRESS.matches(address) || !canStart()) return false
        val peer = try {
            adapter!!.bondedDevices.firstOrNull {
                it.address == address && it.bondState == BluetoothDevice.BOND_BONDED
            }
        } catch (_: SecurityException) { null } ?: return false
        val ticket = generation.incrementAndGet()
        closeTransport()
        transition("guest", "connecting")
        Thread({
            try {
                val link = peer.createRfcommSocketToServiceRecord(serviceUuid)
                if (!adopt(ticket, link) { socket = it }) return@Thread
                link.connect()
                if (generation.get() != ticket) { link.close(); return@Thread }
                link.outputStream.write((HELLO + "\n").toByteArray(Charsets.UTF_8))
                link.outputStream.flush()
                val input = BufferedInputStream(link.inputStream)
                if (readLine(input) != HELLO) throw IOException("BAD_HANDSHAKE")
                exchange(ticket, link, input, "guest")
            } catch (_: SecurityException) { finish(ticket, true, permission = true)
            } catch (_: Exception) { finish(ticket, true) }
        }, "shell-bt-guest").start()
        return true
    }

    /** Connected: a writer thread drains the queue; this thread reads lines. */
    private fun exchange(ticket: Int, link: BluetoothSocket, input: InputStream, side: String) {
        val outgoing = queue
        val output = link.outputStream
        transition(side, "connected")
        Thread({
            try {
                while (generation.get() == ticket) {
                    var next = outgoing.poll(250, TimeUnit.MILLISECONDS) ?: continue
                    while (true) {
                        output.write(next.toByteArray(Charsets.UTF_8))
                        next = outgoing.poll() ?: break
                    }
                    output.flush()
                }
            } catch (_: Exception) { finish(ticket, true) }
        }, "shell-bt-writer").apply { isDaemon = true; start() }
        while (generation.get() == ticket) {
            val line = readLine(input) ?: break
            emit(JSONObject().put("type", "line").put("line", line).toString(), ticket)
        }
        finish(ticket, false)
    }

    /** From the page's bridge thread. False: not connected or not a line. */
    @JavascriptInterface fun send(line: String): Boolean {
        if (state != "connected" || line.indexOf('\n') >= 0 ||
            line.toByteArray(Charsets.UTF_8).size > MAX_LINE) return false
        if (!queue.offer(line + "\n")) { lost("CONGESTION"); return false }
        return true
    }

    @JavascriptInterface @Synchronized fun disconnect() {
        generation.incrementAndGet()
        closeTransport()
        transition("none", "disconnected")
    }

    @Synchronized private fun lost(detail: String) {
        generation.incrementAndGet()
        closeTransport()
        transition("none", "error", detail)
    }

    @Synchronized fun shutdown() {
        generation.incrementAndGet()
        closeTransport()
        role = "none"
        state = "disconnected"
    }

    /** One line of at most MAX_LINE bytes; null at the end of the stream. */
    private fun readLine(input: InputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1) return null
            if (b == 10) return String(bytes.toByteArray(), Charsets.UTF_8)
            if (bytes.size() >= MAX_LINE) throw IOException("LINE_TOO_LONG")
            bytes.write(b)
        }
    }

    /** Publish a transport only if no disconnect superseded this attempt. */
    @Synchronized private fun <T : Closeable> adopt(
        ticket: Int, resource: T, publish: (T) -> Unit
    ): Boolean {
        if (generation.get() == ticket) { publish(resource); return true }
        try { resource.close() } catch (_: IOException) {}
        return false
    }

    @Synchronized private fun finish(ticket: Int, error: Boolean, permission: Boolean = false) {
        if (generation.get() != ticket) return
        generation.incrementAndGet()
        closeTransport()
        if (permission) { transition("none", "permission-required"); return }
        transition("none", if (error) "error" else "disconnected", if (error) "LINK_LOST" else "")
    }
}
