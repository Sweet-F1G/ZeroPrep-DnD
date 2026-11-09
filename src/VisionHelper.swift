import Vision
import AppKit
import Foundation

// VisionHelper: reads JPEG bytes from stdin, runs Apple Vision Framework on Neural Engine, outputs JSON.
func analyzeImage(data: Data) -> [String: Any] {
    guard let ciImage = CIImage(data: data) else {
        return ["error": "Invalid image data", "faces": 0, "summary": "Камера не передала изображение."]
    }
    
    let request = VNDetectFaceLandmarksRequest()
    let handler = VNImageRequestHandler(ciImage: ciImage, orientation: .up, options: [:])
    
    do {
        try handler.perform([request])
    } catch {
        return ["error": error.localizedDescription, "faces": 0, "summary": "Ошибка детекции лиц."]
    }
    
    guard let observations = request.results, !observations.isEmpty else {
        return [
            "faces": 0,
            "summary": "За столом пока никого не видно (игроки отошли или камера направлена в сторону).",
            "attention": "empty",
            "smiling": false,
            "speaking": false,
            "distracted": true,
            "details": []
        ]
    }
    
    var playerDetails: [[String: Any]] = []
    var smilingCount = 0
    var speakingCount = 0
    var lookingDownCount = 0
    var lookingAwayCount = 0
    var focusedCount = 0
    
    for (idx, obs) in observations.enumerated() {
        let yaw = obs.yaw?.doubleValue ?? 0.0
        let pitch = obs.pitch?.doubleValue ?? 0.0
        
        var attention = "focused"
        if pitch < -0.20 {
            attention = "looking_down" // looking at smartphone or dice tray
            lookingDownCount += 1
        } else if abs(yaw) > 0.35 {
            attention = "looking_away"
            lookingAwayCount += 1
        } else {
            focusedCount += 1
        }
        
        var mouthOpen = false
        var smiling = false
        
        if let landmarks = obs.landmarks {
            if let outerLips = landmarks.outerLips, outerLips.pointCount >= 6 {
                let pts = outerLips.normalizedPoints
                let leftCorner = pts.first!
                let rightCorner = pts.last!
                let cornerY = (leftCorner.y + rightCorner.y) / 2.0
                let topLip = pts[pts.count / 4]
                let bottomLip = pts[pts.count * 3 / 4]
                let mouthHeight = abs(topLip.y - bottomLip.y)
                let mouthWidth = max(0.001, abs(rightCorner.x - leftCorner.x))
                let ratio = mouthHeight / mouthWidth
                
                if ratio > 0.20 {
                    mouthOpen = true
                    speakingCount += 1
                }
                
                if cornerY > (topLip.y + bottomLip.y) / 2.0 - 0.015 {
                    smiling = true
                    smilingCount += 1
                }
            }
        }
        
        playerDetails.append([
            "index": idx + 1,
            "attention": attention,
            "mouthOpen": mouthOpen,
            "smiling": smiling,
            "yaw": round(yaw * 100) / 100,
            "pitch": round(pitch * 100) / 100
        ])
    }
    
    let total = observations.count
    var parts: [String] = []
    
    if total == 1 {
        parts.append("В кадре 1 игрок.")
    } else {
        parts.append("В кадре \(total) игроков за столом.")
    }
    
    if speakingCount > 0 {
        parts.append("Кто-то активно говорит или реагирует.")
    }
    
    if smilingCount > 0 {
        if smilingCount == total {
            parts.append("Все улыбаются / смеются.")
        } else {
            parts.append("На лицах видны улыбки и азарт.")
        }
    } else if lookingDownCount > 0 {
        if lookingDownCount == total {
            parts.append("Все смотрят вниз (в телефоны, листы или кубики).")
        } else {
            parts.append("Кто-то смотрит вниз (в телефон или на кубики).")
        }
    } else if focusedCount > 0 {
        parts.append("Игроки внимательно и сосредоточенно смотрят на мастера.")
    }
    
    let summaryText = parts.joined(separator: " ")
    
    return [
        "faces": total,
        "summary": summaryText,
        "attention": lookingDownCount > 0 ? "looking_down" : (focusedCount > 0 ? "focused" : "mixed"),
        "smiling": smilingCount > 0,
        "speaking": speakingCount > 0,
        "distracted": lookingDownCount > 0 || lookingAwayCount > 0,
        "details": playerDetails
    ]
}

// Read all bytes from stdin
let stdinData = FileHandle.standardInput.readDataToEndOfFile()
let result = analyzeImage(data: stdinData)

if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: []),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
} else {
    print("{\"faces\":0,\"summary\":\"Ошибка кодирования JSON\"}")
}
