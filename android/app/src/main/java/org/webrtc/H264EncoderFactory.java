package org.webrtc;

import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import androidx.annotation.Nullable;
import java.util.ArrayList;
import java.util.List;

/**
 * Hardware H.264 for every phone that has it. libwebrtc's own factory only takes H.264 encoders
 * named "OMX.qcom." / "OMX.Exynos." – today's Codec2 encoders ("c2.exynos.h264.encoder" on a
 * Pixel, "c2.qti.avc.encoder" …) fall through, and the share runs on VP8 in software: slow.
 * In the org.webrtc package for libwebrtc's package-private helpers.
 */
public class H264EncoderFactory implements VideoEncoderFactory {
    private final @Nullable EglBase14.Context shared;
    private final VideoEncoderFactory fallback;

    public H264EncoderFactory(EglBase.Context context) {
        shared = context instanceof EglBase14.Context ? (EglBase14.Context) context : null;
        fallback = new DefaultVideoEncoderFactory(context, true, true);
    }

    /** The phone's hardware H.264 encoder, if any. */
    private static @Nullable MediaCodecInfo hardwareH264() {
        for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
            if (info.isEncoder() && MediaCodecUtils.codecSupportsType(info, VideoCodecMimeType.H264)
                    && MediaCodecUtils.isHardwareAccelerated(info) && !MediaCodecUtils.isSoftwareOnly(info)) {
                return info;
            }
        }
        return null;
    }

    @Override
    public VideoCodecInfo[] getSupportedCodecs() {
        List<VideoCodecInfo> codecs = new ArrayList<>();
        if (hardwareH264() != null) {
            codecs.add(new VideoCodecInfo(VideoCodecMimeType.H264.name(), MediaCodecUtils.getCodecProperties(VideoCodecMimeType.H264, false), new ArrayList<>()));
        }
        for (VideoCodecInfo c : fallback.getSupportedCodecs()) {
            if (codecs.isEmpty() || !c.name.equalsIgnoreCase("H264")) codecs.add(c);
        }
        return codecs.toArray(new VideoCodecInfo[0]);
    }

    @Override
    public @Nullable VideoEncoder createEncoder(VideoCodecInfo info) {
        MediaCodecInfo codec = info.name.equalsIgnoreCase("H264") ? hardwareH264() : null;
        if (codec == null) return fallback.createEncoder(info);
        MediaCodecInfo.CodecCapabilities caps = codec.getCapabilitiesForType(VideoCodecMimeType.H264.mimeType());
        Integer surfaceColor = MediaCodecUtils.selectColorFormat(MediaCodecUtils.TEXTURE_COLOR_FORMATS, caps);
        Integer yuvColor = MediaCodecUtils.selectColorFormat(MediaCodecUtils.ENCODER_COLOR_FORMATS, caps);
        // keyframes on request only (new viewers, losses) – like the desktop app
        return new HardwareVideoEncoder(new MediaCodecWrapperFactoryImpl(), codec.getName(), VideoCodecMimeType.H264,
                surfaceColor, yuvColor, info.params, 3600, 0, new BaseBitrateAdjuster(), shared);
    }
}
