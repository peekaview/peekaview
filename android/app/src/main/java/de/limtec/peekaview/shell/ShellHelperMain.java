package de.limtec.peekaview.shell;

import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.os.Process;
import android.system.Os;
import org.json.JSONObject;
import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.zip.ZipFile;

/** Detached shell-UID broker. No network listener, arbitrary commands, or ADB after bootstrap. */
public final class ShellHelperMain {
    private final JSONObject config;
    private final SSLContext tls;
    private Session session;

    private ShellHelperMain(JSONObject config) throws Exception {
        this.config = config;
        byte[] pin = android.util.Base64.decode(config.getString("certificate"), 0);
        tls = SSLContext.getInstance("TLSv1.3");
        tls.init(null, new TrustManager[]{new X509TrustManager() {
            public void checkServerTrusted(X509Certificate[] chain, String type) throws java.security.cert.CertificateException {
                try {
                    if (chain.length != 1 || !MessageDigest.isEqual(pin, MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded())))
                        throw new java.security.cert.CertificateException("Untrusted PeekaView endpoint");
                    chain[0].checkValidity();
                } catch (java.security.GeneralSecurityException e) { throw new java.security.cert.CertificateException(e); }
            }
            public void checkClientTrusted(X509Certificate[] chain, String type) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException(); }
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }}, null);
    }

    private SSLSocket connect(int kind, int id) throws Exception {
        Socket raw = new Socket();
        try {
            raw.connect(new InetSocketAddress("127.0.0.1", config.getInt("port")), 5000);
            raw.setTcpNoDelay(true);
            raw.setSoTimeout(10000);
            SSLSocket socket = (SSLSocket) tls.getSocketFactory().createSocket(raw, "127.0.0.1", config.getInt("port"), true);
            socket.startHandshake();
            DataOutputStream out = new DataOutputStream(socket.getOutputStream());
            out.write(android.util.Base64.decode(config.getString("token"), 0));
            out.writeInt(kind);
            out.writeInt(id);
            out.flush();
            socket.setSoTimeout(0);
            return socket;
        } catch (Exception e) { raw.close(); throw e; }
    }

    private void run() throws Exception {
        try (SSLSocket manager = connect(0, 0)) {
            DataInputStream in = new DataInputStream(manager.getInputStream());
            DataOutputStream out = new DataOutputStream(manager.getOutputStream());
            while (true) {
                int command = in.readInt();
                if (command == 0) { out.writeInt(Process.myPid()); out.flush(); continue; }
                if (command == 5) {
                    // Android's input command waits for event handling, unlike scrcpy's async
                    // paste flag. No text or arbitrary command is passed to this process.
                    java.lang.Process paste = new ProcessBuilder("/system/bin/input", "-d", "0", "keyevent", "279").start();
                    boolean done = paste.waitFor(10, java.util.concurrent.TimeUnit.SECONDS);
                    if (!done) paste.destroyForcibly();
                    out.writeUTF(done && paste.exitValue() == 0 ? "" : "Android konnte den Text nicht einfügen"); out.flush();
                    continue;
                }
                if (command == 4) {
                    // The user activated this helper to keep working without wireless debugging.
                    // Disable only the Wi-Fi transport, never USB debugging or Developer options.
                    java.lang.Process settings = new ProcessBuilder("/system/bin/settings", "put", "global", "adb_wifi_enabled", "0").start();
                    if (!settings.waitFor(5, java.util.concurrent.TimeUnit.SECONDS) || settings.exitValue() != 0) {
                        settings.destroy();
                        throw new IOException("WLAN-Debugging konnte nicht ausgeschaltet werden");
                    }
                    out.writeUTF(""); out.flush();
                    continue;
                }
                try {
                    if (command == 7) {
                        if (session == null || session.frames == null) throw new IOException("Keine App-Freigabe aktiv.");
                        session.frames.update(in.readLong(), new org.json.JSONArray(in.readUTF()));
                        out.writeUTF(""); out.flush();
                        continue;
                    }
                    if (command == 1 || command == 6) {
                        if (session != null) throw new IOException("A capture is already active");
                        session = new Session(in.readInt());
                        if (command == 6) {
                            long generation = in.readLong();
                            org.json.JSONArray apps = new org.json.JSONArray(in.readUTF());
                            session.open(generation, apps);
                        } else session.open(0, null);
                        out.writeUTF(""); out.flush();
                        try { session.relay(); }
                        catch (Exception e) { throw new java.io.EOFException("Local relay setup failed: " + e); }
                    } else if (command == 2) {
                        if (session != null) session.close();
                        session = null;
                        out.writeUTF(""); out.flush();
                    } else throw new IOException("Unknown helper command");
                } catch (java.io.EOFException e) { throw e; }
                catch (Exception e) {
                    if (session != null) session.close();
                    session = null;
                    out.writeUTF(e.getMessage() == null ? e.toString() : e.getMessage()); out.flush();
                }
            }
        } finally { if (session != null) session.close(); }
    }

    private final class Session implements Closeable {
        private final int id;
        private final List<Closeable> sockets = Collections.synchronizedList(new ArrayList<>());
        private java.lang.Process child;
        private File serverJar;
        private AppFrames frames;
        private LocalSocket video, control;
        private volatile boolean closed;
        private final StringBuilder logs = new StringBuilder();
        Session(int id) { this.id = id; }

        void open(long generation, org.json.JSONArray apps) throws Exception {
            // scrcpy's cleanup process unlinks its own JAR; each capture needs a fresh copy.
            serverJar = File.createTempFile("peekaview-capture-", ".jar", new File("/data/local/tmp"));
            Os.chmod(serverJar.getPath(), 0600);
            try (ZipFile apk = new ZipFile(config.getString("apk"));
                 InputStream source = apk.getInputStream(apk.getEntry("assets/scrcpy-server"));
                 OutputStream dest = new FileOutputStream(serverJar)) { copy(source, dest); }
            if (apps != null) frames = new AppFrames(serverJar, generation, apps);
            ProcessBuilder builder = new ProcessBuilder("/system/bin/app_process", "/", "--nice-name=peekaview-capture", "com.genymobile.scrcpy.Server",
                config.getString("version"), "scid=" + Integer.toHexString(id), "display_id=0", "audio=false", "video_codec=h264",
                "video=" + (frames == null), "max_size=1600", "max_fps=30", "video_bit_rate=6000000", "tunnel_forward=true", "send_dummy_byte=false",
                "send_device_meta=false", "clipboard_autosync=false", "downsize_on_error=false", "stay_awake=true");
            builder.environment().put("CLASSPATH", serverJar.getPath());
            builder.redirectErrorStream(true);
            child = builder.start();
            Thread logger = new Thread(() -> {
                try (BufferedReader r = new BufferedReader(new InputStreamReader(child.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) synchronized (logs) {
                        logs.append(line).append('\n');
                        if (logs.length() > 2000) logs.delete(0, logs.length() - 2000);
                    }
                } catch (IOException ignored) { /* process cleanup closes its pipe */ }
            }, "capture-log");
            logger.setDaemon(true); logger.start();
            long deadline = System.nanoTime() + 15_000_000_000L;
            while (true) {
                try { if (frames == null) video = local(); else control = local(); break; }
                catch (IOException e) {
                    if (!child.isAlive() || System.nanoTime() >= deadline) {
                        synchronized (logs) { throw new IOException("Shell capture did not start: " + logs, e); }
                    }
                    Thread.sleep(50);
                }
            }
            if (frames == null) control = local();
        }

        private LocalSocket local() throws IOException {
            LocalSocket s = new LocalSocket();
            try {
                s.connect(new LocalSocketAddress(String.format(Locale.ROOT, "scrcpy_%08x", id)));
                sockets.add(s);
                return s;
            } catch (IOException e) { s.close(); throw e; }
        }

        void relay() throws Exception {
            SSLSocket picture = connect(1, id); sockets.add(picture);
            SSLSocket inputs = connect(2, id); sockets.add(inputs);
            if (frames == null) pump(video.getInputStream(), picture.getOutputStream());
            else {
                Thread pictures = new Thread(() -> {
                    try { frames.stream(new DataOutputStream(picture.getOutputStream()), () -> closed); }
                    catch (Exception e) { if (!closed) android.util.Log.e("peekaview-helper", "App capture stopped", e); }
                    finally { close(); }
                }, "app-frames");
                pictures.setDaemon(true); pictures.start();
            }
            pump(inputs.getInputStream(), control.getOutputStream());
            // Consume scrcpy clipboard acknowledgements; the app never reads the device clipboard.
            pump(control.getInputStream(), inputs.getOutputStream());
        }

        private void pump(InputStream in, OutputStream out) {
            Thread t = new Thread(() -> { try { copy(in, out); } catch (IOException ignored) { /* closing either endpoint stops this capture */ } finally { close(); } }, "shell-relay");
            t.setDaemon(true); t.start();
        }

        public synchronized void close() {
            if (closed) return;
            closed = true;
            synchronized (sockets) { for (Closeable s : sockets) try { s.close(); } catch (IOException ignored) {} }
            if (child != null) {
                try {
                    if (!child.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) {
                        child.destroy();
                        if (!child.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) child.destroyForcibly();
                    }
                } catch (InterruptedException e) { Thread.currentThread().interrupt(); child.destroyForcibly(); }
            }
            if (serverJar != null) serverJar.delete();
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[65536];
        int count;
        while ((count = in.read(buffer)) != -1) { out.write(buffer, 0, count); out.flush(); }
    }

    public static void main(String[] args) {
        try {
            if (Process.myUid() != 2000) throw new SecurityException("Shell UID required");
            File bootstrap = new File(args[0]);
            JSONObject config;
            try { config = new JSONObject(new String(Files.readAllBytes(bootstrap.toPath()), java.nio.charset.StandardCharsets.UTF_8)); }
            finally { bootstrap.delete(); }
            new ShellHelperMain(config).run();
        } catch (Exception e) { android.util.Log.e("peekaview-helper", "Helper stopped", e); }
        finally { System.exit(0); }
    }
}
