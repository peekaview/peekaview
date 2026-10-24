package de.limtec.peekaview.shell;

import android.content.ComponentName;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorSpace;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import dalvik.system.PathClassLoader;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Compositor-enforced UID captures of visible real-display tasks, never an unfiltered frame. */
@android.annotation.TargetApi(34)
final class AppFrames {
    static final int MAGIC = 0x706a7067;
    private static Class<?> physicalDisplayControl;
    private final Object displayManager, taskManager, windowManager;
    private final Method keyguard;
    private final Method displayInfo, tasks, capture, build, setUid, setSize;
    private final Class<?> builderClass;
    private final IBinder displayToken;
    private volatile Policy policy;

    private static final class Policy {
        final long generation;
        final Map<String, Integer> apps = new HashMap<>();
        Policy(long generation, JSONArray selected) throws Exception {
            if (generation <= 0 || selected.length() > 256) throw new IllegalArgumentException("Invalid app selection");
            this.generation = generation;
            for (int i = 0; i < selected.length(); i++) {
                JSONObject app = selected.getJSONObject(i);
                int uid = app.getInt("uid");
                if (uid < 10000) throw new IllegalArgumentException("System UID cannot be shared separately");
                apps.put(app.getString("id"), uid);
            }
        }
    }

    AppFrames(File server, long generation, JSONArray apps) throws Exception {
        if (Build.VERSION.SDK_INT < 34) throw new IllegalStateException("App-Freigabe benötigt Android 14 oder neuer.");
        update(generation, apps);
        // Reuse the bundled, version-pinned scrcpy wrapper for the physical display token.
        if (physicalDisplayControl == null) {
            ClassLoader loader = new PathClassLoader(server.getPath(), getClass().getClassLoader());
            physicalDisplayControl = loader.loadClass("com.genymobile.scrcpy.wrappers.DisplayControl");
        }
        Class<?> control = physicalDisplayControl;
        Class<?> dm = Class.forName("android.hardware.display.DisplayManagerGlobal");
        displayManager = dm.getMethod("getInstance").invoke(null);
        displayInfo = dm.getMethod("getDisplayInfo", int.class);
        Object info = displayInfo.invoke(displayManager, 0);
        Object address = info.getClass().getField("address").get(info);
        long physicalId = (Long) address.getClass().getMethod("getPhysicalDisplayId").invoke(address);
        displayToken = (IBinder) control.getMethod("getPhysicalDisplayToken", long.class).invoke(null, physicalId);
        String api = Build.VERSION.SDK_INT >= 37 ? "android.window.ScreenCaptureInternal" : "android.window.ScreenCapture";
        Class<?> screen = Class.forName(api);
        builderClass = Class.forName(api + "$DisplayCaptureArgs$Builder");
        capture = screen.getMethod("captureDisplay", Class.forName(api + "$DisplayCaptureArgs"));
        build = builderClass.getMethod("build");
        setUid = builderClass.getMethod("setUid", long.class);
        setSize = builderClass.getMethod("setSize", int.class, int.class);
        Class<?> atm = Class.forName("android.app.ActivityTaskManager");
        taskManager = atm.getMethod("getService").invoke(null);
        tasks = Class.forName("android.app.IActivityTaskManager").getMethod("getTasks", int.class, boolean.class, boolean.class, int.class);
        IBinder wm = (IBinder) Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "window");
        windowManager = Class.forName("android.view.IWindowManager$Stub").getMethod("asInterface", IBinder.class).invoke(null, wm);
        keyguard = Class.forName("android.view.IWindowManager").getMethod("isKeyguardLocked");
    }

    void update(long generation, JSONArray apps) throws Exception {
        Policy next = new Policy(generation, apps);
        if (policy != null && generation <= policy.generation) throw new IllegalArgumentException("Stale app selection");
        policy = next;
    }

    private Bitmap snapshot(int uid, int width, int height) throws Exception {
        Object args = builderClass.getConstructor(IBinder.class).newInstance(displayToken);
        setUid.invoke(args, (long) uid);
        setSize.invoke(args, width, height);
        if (Build.VERSION.SDK_INT >= 37) {
            Class<?> rules = Class.forName("android.window.ScreenCapture$ScreenCaptureParams");
            builderClass.getMethod("setSecureContentPolicy", int.class).invoke(args, rules.getField("SECURE_CONTENT_POLICY_REDACT").getInt(null));
            builderClass.getMethod("setProtectedContentPolicy", int.class).invoke(args, rules.getField("PROTECTED_CONTENT_POLICY_REDACT").getInt(null));
            builderClass.getMethod("setIncludeSystemOverlays", boolean.class).invoke(args, false);
        } else {
            builderClass.getMethod("setCaptureSecureLayers", boolean.class).invoke(args, false);
            builderClass.getMethod("setAllowProtected", boolean.class).invoke(args, false);
        }
        // Secure/protected capture remains disabled. Unsupported APIs fail; never capture all UIDs.
        Object shot = capture.invoke(null, build.invoke(args));
        if (shot == null) throw new IllegalStateException("Android konnte das App-Fenster nicht aufnehmen.");
        HardwareBuffer buffer = (HardwareBuffer) shot.getClass().getMethod("getHardwareBuffer").invoke(shot);
        try {
            ColorSpace colors = (ColorSpace) shot.getClass().getMethod("getColorSpace").invoke(shot);
            Bitmap hardware = Bitmap.wrapHardwareBuffer(buffer, colors);
            if (hardware == null) throw new IllegalStateException("App-Bildpuffer ist nicht verfügbar.");
            try { return hardware.copy(Bitmap.Config.ARGB_8888, false); }
            finally { hardware.recycle(); }
        } finally { buffer.close(); }
    }

    void stream(DataOutputStream out, java.util.function.BooleanSupplier closed) throws Exception {
        out.writeInt(MAGIC); out.flush();
        while (!closed.getAsBoolean()) {
            long began = SystemClock.uptimeMillis();
            Policy current = policy;
            Object info = displayInfo.invoke(displayManager, 0);
            int realWidth = info.getClass().getField("logicalWidth").getInt(info);
            int realHeight = info.getClass().getField("logicalHeight").getInt(info);
            float scale = Math.min(1f, 1600f / Math.max(realWidth, realHeight));
            int width = Math.max(2, (int) (realWidth * scale) / 2 * 2);
            int height = Math.max(2, (int) (realHeight * scale) / 2 * 2);
            Bitmap image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            Map<Integer, Bitmap> images = new HashMap<>();
            boolean visible = false;
            try {
                Canvas canvas = new Canvas(image);
                canvas.drawColor(Color.BLACK);
                List<?> running = (Boolean) keyguard.invoke(windowManager) ? java.util.Collections.emptyList()
                    : (List<?>) tasks.invoke(taskManager, 64, false, false, 0);
                // Android returns front-to-back; compose physical task rectangles back-to-front.
                for (int i = running.size() - 1; i >= 0; i--) {
                    Object task = running.get(i);
                    if (!task.getClass().getField("isVisible").getBoolean(task)) continue;
                    ComponentName top = (ComponentName) task.getClass().getField("topActivity").get(task);
                    if (top == null) continue;
                    Integer uid = current.apps.get(top.getPackageName());
                    if (uid == null) continue;
                    Configuration config = (Configuration) task.getClass().getField("configuration").get(task);
                    Object wc = Configuration.class.getField("windowConfiguration").get(config);
                    Rect bounds = new Rect((Rect) wc.getClass().getMethod("getBounds").invoke(wc));
                    if (!bounds.intersect(0, 0, realWidth, realHeight)) continue;
                    Bitmap app = images.get(uid);
                    if (app == null) { app = snapshot(uid, width, height); images.put(uid, app); }
                    Rect region = new Rect(bounds.left * width / realWidth, bounds.top * height / realHeight,
                        bounds.right * width / realWidth, bounds.bottom * height / realHeight);
                    canvas.drawBitmap(app, region, region, null);
                    visible = true;
                }
                ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
                if (!image.compress(Bitmap.CompressFormat.JPEG, 90, jpeg)) throw new IllegalStateException("App-Bild konnte nicht kodiert werden.");
                byte[] bytes = jpeg.toByteArray();
                out.writeLong(current.generation); out.writeInt(width); out.writeInt(height);
                out.writeBoolean(visible); out.writeLong(System.nanoTime());
                out.writeInt(bytes.length); out.write(bytes); out.flush();
            } finally {
                image.recycle();
                for (Bitmap app : images.values()) app.recycle();
            }
            // Independent frames let the app discard every previous-policy frame immediately.
            SystemClock.sleep(Math.max(0, 67 - (SystemClock.uptimeMillis() - began)));
        }
    }
}
