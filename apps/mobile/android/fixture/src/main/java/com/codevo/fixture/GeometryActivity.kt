package com.codevo.fixture

import android.app.Activity
import android.os.Bundle
import android.graphics.Rect
import android.view.Gravity
import android.view.WindowInsets
import android.webkit.WebView
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class GeometryActivity: Activity() {
    lateinit var editor: EditText
    var browser: WebView? = null
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }
        root.addView(TextView(this).apply { text="Synthetic bottom composer. No microphone or pairing required." },LinearLayout.LayoutParams(-1,0,1f))
        editor=EditText(this).apply {
            inputType=android.text.InputType.TYPE_CLASS_TEXT
            contentDescription="Bottom composer"
            setText("Synthetic caret")
            setSelection(text.length)
            minHeight=(48*resources.displayMetrics.density).toInt()
            gravity=Gravity.BOTTOM
        }
        if (intent.getBooleanExtra("web",false)) {
            browser=WebView(this).apply {
                settings.javaScriptEnabled=true
                loadData("""<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#eee"><main style="height:100vh;display:flex;flex-direction:column"><p style="flex:1">Synthetic browser bottom composer</p><div id="composer" role="textbox" aria-label="Bottom browser composer" contenteditable="true" onfocus="getSelection().selectAllChildren(this);getSelection().collapseToEnd()" style="font-size:18px;min-height:48px;box-sizing:border-box;width:100%">Synthetic caret</div></main></body></html>""","text/html","UTF-8")
            }
            root.addView(browser,LinearLayout.LayoutParams(-1,0,100f))
        } else root.addView(editor,LinearLayout.LayoutParams(-1,-2))
        setContentView(root)
        if (browser==null) {
            editor.requestFocus()
        }
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && browser==null && ::editor.isInitialized) editor.post {
            window.insetsController?.show(WindowInsets.Type.ime())
        }
    }
    fun hostGeometry(): IntArray {
        val decor=window.decorView
        val ime=decor.rootWindowInsets.getInsets(WindowInsets.Type.ime()).bottom
        val navigation=decor.rootWindowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.navigationBars() or WindowInsets.Type.displayCutout())
        val nav=navigation.bottom
        val screen=windowManager.currentWindowMetrics.bounds
        val visible=Rect().also { decor.getWindowVisibleDisplayFrame(it) }
        val position=IntArray(2).also { editor.getLocationOnScreen(it) }
        val line=editor.layout?.getLineForOffset(editor.selectionEnd) ?: 0
        val caretBottom=position[1]+editor.totalPaddingTop+(editor.layout?.getLineBottom(line) ?: editor.height)-editor.scrollY
        return intArrayOf(screen.bottom,ime,nav,visible.bottom,position[1]+editor.height,caretBottom,navigation.left,navigation.right)
    }
}
