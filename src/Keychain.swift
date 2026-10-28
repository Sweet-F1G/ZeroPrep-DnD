import Foundation
import Security

// A separate invocation of the app handles credentials before starting AppKit.
// Secrets travel over stdin/stdout, never command arguments or a settings file.
func handleCredentialCommand() -> Bool {
    let args = CommandLine.arguments
    guard args.count == 3, args[1] == "--credentials" else { return false }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "local.skazitel.api-credentials",
        kSecAttrAccount as String: "providers"]
    func check(_ status: OSStatus) {
        if status != errSecSuccess { exit(1) }
    }
    switch args[2] {
    case "load":
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { FileHandle.standardOutput.write(Data("{}".utf8)); return true }
        check(status)
        guard let data = result as? Data else { exit(1) }
        FileHandle.standardOutput.write(data)
    case "save":
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard data.count <= 32768,
              let keys = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              keys.keys.allSatisfy({ ["openai", "gemini", "compatible", "groq", "elevenlabs"].contains($0) }) else { exit(1) }
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrLabel as String] = "Сказитель — API-ключи"
            check(SecItemAdd(item as CFDictionary, nil))
        } else { check(status) }
    case "clear":
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecItemNotFound { check(status) }
    default: exit(1)
    }
    return true
}
