import Cocoa
import WebKit
import AVFoundation
import CFNetwork

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, AVSpeechSynthesizerDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var started = false
    var startupFailed = false
    var diagnosticURL: URL?
    var pendingOutput = ""
    let voice = AVSpeechSynthesizer()
    var baseURL: URL?
    var speechIDs: [ObjectIdentifier: Int] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        voice.delegate = self
        let menu = NSMenu()
        let item = NSMenuItem()
        menu.addItem(item)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "О Сказителе", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Завершить Сказитель", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu
        let editItem = NSMenuItem(title: "Правка", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "Правка")
        for (title, action, key) in [("Отменить", "undo:", "z"), ("Вырезать", "cut:", "x"), ("Скопировать", "copy:", "c"), ("Вставить", "paste:", "v"), ("Выбрать всё", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "nativeVoice")
        config.userContentController.add(self, name: "nativeExport")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Сказитель — ваш мастер за столом"
        window.minSize = NSSize(width: 900, height: 680)
        window.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.10, blue: 0.08, alpha: 1)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.loadHTMLString("<html><body style=\"background:#101916;color:#e4e5da;font:18px -apple-system;text-align:center;padding-top:25vh\"><div style=\"color:#c9a973;font-size:52px\">✦</div><p>Готовим ваш игровой стол…</p></body></html>", baseURL: nil)
        startServer()
    }

    func startServer() {
        guard let resources = Bundle.main.resourceURL else { return }
        let appFolder = Bundle.main.bundleURL.deletingLastPathComponent()
        let installed = Bundle.main.object(forInfoDictionaryKey: "SkazitelInstalledLayout") as? Bool == true
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let data = installed ? support.appendingPathComponent("Skazitel/Saves") : appFolder.appendingPathComponent("Saves")
        do {
            try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
            diagnosticURL = data.appendingPathComponent("startup.log")
            FileManager.default.createFile(atPath: diagnosticURL!.path, contents: Data(), attributes: [.posixPermissions: 0o600])
            recordDiagnostic("bundle=\(Bundle.main.bundleURL.path) data=\(data.path)")
            let process = Process()
            process.executableURL = resources.appendingPathComponent("node")
            process.arguments = [resources.appendingPathComponent("src/server.mjs").path]
            process.currentDirectoryURL = appFolder
            var environment = ProcessInfo.processInfo.environment
            environment["SKAZITEL_DATA"] = data.path
            environment["SKAZITEL_VOICE_DIR"] = (installed ? resources : appFolder).appendingPathComponent("LocalVoice").path
            environment["PORT"] = "0"
            let keyStoreBinary = resources.appendingPathComponent("KeyStore.app/Contents/MacOS/Skazitel").path
            if FileManager.default.fileExists(atPath: keyStoreBinary) {
                environment["SKAZITEL_KEYCHAIN_HELPER"] = keyStoreBinary
            } else {
                environment["SKAZITEL_KEYCHAIN_HELPER"] = Bundle.main.executableURL?.path
            }
            // Node does not inherit the macOS system proxy unless explicitly configured.
            // Reuse the user's existing HTTP(S) proxy and keep all local app traffic direct.
            if let proxies = CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String: Any] {
                for (scheme, enabledKey, hostKey, portKey) in [
                    ("HTTP", "HTTPEnable", "HTTPProxy", "HTTPPort"),
                    ("HTTPS", "HTTPSEnable", "HTTPSProxy", "HTTPSPort")
                ] {
                    if environment[scheme + "_PROXY"] == nil && environment[scheme.lowercased() + "_proxy"] == nil,
                       (proxies[enabledKey] as? NSNumber)?.boolValue == true,
                       let host = proxies[hostKey] as? String,
                       let port = proxies[portKey] as? NSNumber {
                        var proxyURL = URLComponents()
                        proxyURL.scheme = "http"
                        proxyURL.host = host
                        proxyURL.port = port.intValue
                        environment[scheme + "_PROXY"] = proxyURL.string
                    }
                }
            }
            environment["NODE_USE_ENV_PROXY"] = "1"
            let bypass = environment["NO_PROXY"] ?? environment["no_proxy"] ?? ""
            environment["NO_PROXY"] = ([bypass, "127.0.0.1", "localhost", "::1"].filter { !$0.isEmpty }).joined(separator: ",")
            process.environment = environment
            let output = Pipe(), errors = Pipe()
            process.standardOutput = output
            process.standardError = errors
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let bytes = handle.availableData
                guard !bytes.isEmpty, let text = String(data: bytes, encoding: .utf8) else { return }
                DispatchQueue.main.async {
                    guard let self = self, !self.started else { return }
                    self.recordDiagnostic("stdout: " + text)
                    self.pendingOutput += text
                    if let line = self.pendingOutput.components(separatedBy: "\n").first(where: { $0.hasPrefix("SKAZITEL_URL=") }), let url = URL(string: String(line.dropFirst(13))) {
                        self.started = true
                        self.baseURL = url
                        self.webView.load(URLRequest(url: url))
                    }
                }
            }
            errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let bytes = handle.availableData
                if let text = String(data: bytes, encoding: .utf8), !text.isEmpty { DispatchQueue.main.async { self?.recordDiagnostic("stderr: " + text) } }
            }
            process.terminationHandler = { [weak self] task in
                if task.terminationStatus != 0 { DispatchQueue.main.async { self?.recordDiagnostic("exit=\(task.terminationStatus)"); self?.startupFailed = true; self?.showError("Локальный сервер остановился. Проверьте папку Saves и перезапустите приложение. Исходные сохранения не удалялись.") } }
            }
            server = process
            try process.run()
            recordDiagnostic("spawned pid=\(process.processIdentifier)")
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
                if self?.started == false && self?.startupFailed == false { self?.recordDiagnostic("timeout; running=\(self?.server?.isRunning ?? false)"); self?.startupFailed = true; self?.showError("Не удалось запустить локальный сервер. Проверьте доступ к папке сохранений приложения.") }
            }
        } catch { showError("Не удалось запустить приложение: \(error.localizedDescription)") }
    }
    func recordDiagnostic(_ message: String) {
        guard let file = diagnosticURL else { return }
        let text = String(message.prefix(8000)).replacingOccurrences(of: "(?:gsk_|sk-)[A-Za-z0-9_-]+", with: "[ключ скрыт]", options: .regularExpression)
        let line = "[\(Date())] \(text)\n"
        if let handle = try? FileHandle(forWritingTo: file) { handle.seekToEndOfFile(); handle.write(Data(line.utf8)); try? handle.close() }
    }
    func showError(_ text: String) {
        let alert = NSAlert()
        alert.messageText = "Сказитель"
        alert.informativeText = text
        alert.runModal()
    }
    @objc func about() { showError("Сказитель 0.4.1\nГолосовой ведущий D&D. В установленной версии сохранения находятся в Library/Application Support/Skazitel/Saves; в переносной — рядом с приложением. Ключи API сохраняются в защищённой Связке ключей macOS.\n\nУчебный режим использует заготовленные ответы. Для свободной игры подключите модель.") }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        voice.stopSpeaking(at: .immediate)
        server?.terminationHandler = nil
        server?.terminate()
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if baseURL == nil && navigationAction.request.url?.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if let url = navigationAction.request.url, url.host == "127.0.0.1", url.port == baseURL?.port { decisionHandler(.allow) }
        else { decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard origin.host == "127.0.0.1", origin.port == baseURL?.port, type == .microphone else { decisionHandler(.deny); return }
        AVCaptureDevice.requestAccess(for: .audio) { granted in DispatchQueue.main.async { decisionHandler(granted ? .grant : .deny) } }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Сказитель"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Сказитель"
        alert.informativeText = message
        alert.addButton(withTitle: "Да, удалить")
        alert.addButton(withTitle: "Отмена")
        alert.alertStyle = .warning
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if let id = speechIDs.removeValue(forKey: ObjectIdentifier(utterance)) {
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('skazitel-voice-ended',{detail: \(id)}))", completionHandler: nil)
        }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speechIDs.removeValue(forKey: ObjectIdentifier(utterance))
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let data = message.body as? [String: Any] else { return }
        if message.name == "nativeVoice" {
            voice.stopSpeaking(at: .immediate)
            if let text = data["text"] as? String {
                let utterance = AVSpeechUtterance(string: text)
                utterance.voice = AVSpeechSynthesisVoice(language: "ru-RU")
                utterance.rate = AVSpeechUtteranceDefaultSpeechRate
                speechIDs[ObjectIdentifier(utterance)] = data["speechId"] as? Int
                voice.speak(utterance)
            }
        } else if message.name == "nativeExport", let text = data["text"] as? String {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = data["name"] as? String ?? "campaign.json"
            panel.beginSheetModal(for: window) { result in
                if result == .OK, let url = panel.url { do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { self.showError("Не удалось сохранить экспорт: \(error.localizedDescription)") } }
            }
        }
    }
}
if handleCredentialCommand() { exit(0) }
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
