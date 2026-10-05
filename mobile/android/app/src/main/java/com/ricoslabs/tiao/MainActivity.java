package com.ricoslabs.tiao;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void load() {
        super.load();
        // Installed before the WebView's first request runs on the next UI-thread turn.
        bridge.setWebViewClient(new TiaoWebViewClient(bridge));
    }
}
