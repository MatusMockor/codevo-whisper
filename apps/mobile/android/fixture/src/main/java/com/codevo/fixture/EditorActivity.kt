package com.codevo.fixture

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Button
import android.webkit.WebView

class EditorActivity:Activity() {
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        val layout=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(16,24,16,16) }
        val first=EditText(this).apply { id=1001;hint="First editor";contentDescription="First editor";inputType=InputType.TYPE_CLASS_TEXT }
        val second=EditText(this).apply { id=1002;hint="Second editor";contentDescription="Second editor";inputType=InputType.TYPE_CLASS_TEXT }
        val password=EditText(this).apply { id=1003;hint="Password";contentDescription="Password";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        layout.addView(first);layout.addView(second);layout.addView(password)
        layout.addView(Button(this).apply { text="Browser field";setOnClickListener {
            val browser=WebView(this@EditorActivity)
            setContentView(browser)
            browser.loadData("<html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='padding-top:80px'><label>Browser editor<input aria-label='Browser editor' autofocus></label></body></html>","text/html","UTF-8")
        } })
        setContentView(layout)
        first.requestFocus()
        first.postDelayed({ (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(first,InputMethodManager.SHOW_IMPLICIT) },300)
    }
}
