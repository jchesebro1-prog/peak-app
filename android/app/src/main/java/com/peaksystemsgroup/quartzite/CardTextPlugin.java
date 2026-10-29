package com.peaksystemsgroup.quartzite;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/** Booth mode "Scan card": on-device text recognition with ML Kit (bundled model, no network). */
@CapacitorPlugin(name = "CardText")
public class CardTextPlugin extends Plugin {
    @PluginMethod
    public void recognize(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) { call.reject("Couldn't read that photo."); return; }
        byte[] bytes;
        try { bytes = Base64.decode(b64, Base64.DEFAULT); } catch (IllegalArgumentException e) { call.reject("Couldn't read that photo."); return; }
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) { call.reject("Couldn't read that photo."); return; }
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            .process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener((Text text) -> {
                JSArray lines = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks())
                    for (Text.Line line : block.getLines()) lines.put(line.getText());
                JSObject ret = new JSObject();
                ret.put("lines", lines);
                call.resolve(ret);
            })
            .addOnFailureListener((Exception e) -> call.reject("Text recognition failed: " + e.getMessage()));
    }
}
