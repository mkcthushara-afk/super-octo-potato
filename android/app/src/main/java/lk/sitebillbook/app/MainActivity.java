package lk.sitebillbook.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Site Bill Book on Android: a full-screen window onto the online app.
 * Logins and bills stay on the server; the phone only adds saving and sharing of PDFs.
 */
public class MainActivity extends Activity {
    private WebView web;

    private static final String OFFLINE_PAGE =
        "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        + "<body style='font-family:sans-serif;padding:32px;color:#16201E;background:#EEF2F0'>"
        + "<h2>No internet connection</h2>"
        + "<p>Site Bill Book needs the internet to load your bills. Check your connection and try again.</p>"
        + "<button onclick=\"location.href='" + BuildConfig.APP_URL + "/'\" "
        + "style='padding:12px 18px;border-radius:8px;border:0;background:#0F6B5C;color:#fff;font-size:16px'>Try again</button>";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "SiteBillBookAndroid");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (BuildConfig.APP_HOST.equals(uri.getHost())) return false;
                // Links to other sites, phone numbers and WhatsApp open in their own apps.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No app can open this link.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(BuildConfig.APP_URL + "/");
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** Called from the page with a finished PDF: share it (WhatsApp, email...) or save it to Downloads. */
    private class Bridge {
        @JavascriptInterface
        public void savePdf(String base64, String filename, boolean share) {
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                toast("Could not read the PDF.");
                return;
            }
            final String name = filename.replaceAll("[^\\w.\\- ]+", "_");
            runOnUiThread(() -> {
                try {
                    if (share) sharePdf(bytes, name);
                    else downloadPdf(bytes, name);
                } catch (Exception e) {
                    toast("Could not save the PDF.");
                }
            });
        }
    }

    private void sharePdf(byte[] bytes, String name) throws Exception {
        File dir = new File(getCacheDir(), "pdfs");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("no cache dir");
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("application/pdf");
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(send, "Send bill"));
    }

    private void downloadPdf(byte[] bytes, String name) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new Exception("no download uri");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new Exception("no stream");
                out.write(bytes);
            }
            toast("Saved to Downloads: " + name);
        } else {
            // Android 8 and 9: no shared Downloads access without extra permissions, so offer to send it instead.
            sharePdf(bytes, name);
        }
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }
}
