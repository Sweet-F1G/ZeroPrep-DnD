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
    var tiredCount = 0
    var neutralCount = 0
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
        var tired = false
        var yawning = false
        var neutral = false
        
        if let landmarks = obs.landmarks {
            // 1. Analyze Eyes (Eye Aspect Ratio / EAR) for alertness vs fatigue
            func ear(_ region: VNFaceLandmarkRegion2D?) -> Double {
                guard let region = region, region.pointCount >= 4 else { return 0.25 }
                let pts = region.normalizedPoints
                guard let minX = pts.map({ $0.x }).min(),
                      let maxX = pts.map({ $0.x }).max(),
                      let minY = pts.map({ $0.y }).min(),
                      let maxY = pts.map({ $0.y }).max() else { return 0.25 }
                let width = max(0.001, maxX - minX)
                let height = maxY - minY
                return height / width
            }
            
            let leftEar = ear(landmarks.leftEye)
            let rightEar = ear(landmarks.rightEye)
            let avgEar = (leftEar + rightEar) / 2.0
            
            // 2. Analyze Lips geometry using spatial bounds (not arbitrary indices)
            if let outerLips = landmarks.outerLips, outerLips.pointCount >= 6 {
                let pts = outerLips.normalizedPoints
                if let leftCorner = pts.min(by: { $0.x < $1.x }),
                   let rightCorner = pts.max(by: { $0.x < $1.x }),
                   let topLip = pts.max(by: { $0.y < $1.y }),
                   let bottomLip = pts.min(by: { $0.y < $1.y }) {
                    
                    let mouthWidth = max(0.001, rightCorner.x - leftCorner.x)
                    let mouthHeight = max(0.001, topLip.y - bottomLip.y)
                    let mouthAspect = mouthWidth / mouthHeight
                    let mouthOpeningRatio = mouthHeight / mouthWidth
                    
                    let cornerAvgY = (leftCorner.y + rightCorner.y) / 2.0
                    let lipCenterY = (topLip.y + bottomLip.y) / 2.0
                    let cornerLift = cornerAvgY - lipCenterY
                    
                    if mouthOpeningRatio > 0.40 && avgEar < 0.20 {
                        yawning = true
                        tired = true
                    } else if mouthOpeningRatio > 0.26 {
                        mouthOpen = true
                        speakingCount += 1
                    }
                    
                    // True smile: corners genuinely lifted upward relative to mouth center line
                    // AND mouth horizontally elongated
                    if cornerLift > 0.010 && mouthAspect > 2.6 {
                        smiling = true
                        smilingCount += 1
                    } else if avgEar < 0.17 || (avgEar < 0.20 && cornerLift < -0.004) {
                        // Heavy eyelids or drooping mouth corners -> fatigue / tired
                        tired = true
                        tiredCount += 1
                    } else {
                        // Resting face with normal alertness
                        neutral = true
                        neutralCount += 1
                    }
                }
            } else {
                neutral = true
                neutralCount += 1
            }
        } else {
            neutral = true
            neutralCount += 1
        }
        
        var expression = "neutral"
        if smiling { expression = "smiling" }
        else if yawning { expression = "yawning" }
        else if tired { expression = "tired" }
        else if mouthOpen { expression = "speaking" }
        
        playerDetails.append([
            "index": idx + 1,
            "attention": attention,
            "expression": expression,
            "mouthOpen": mouthOpen,
            "smiling": smiling,
            "tired": tired,
            "yawning": yawning,
            "neutral": neutral,
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
    } else if tiredCount > 0 {
        if tiredCount == total {
            parts.append("Игрок выглядит усталым (тяжёлые веки, спокойный утомлённый взгляд).")
        } else {
            parts.append("Кто-то за столом выглядит уставшим или сонным.")
        }
    } else if lookingDownCount > 0 {
        if lookingDownCount == total {
            parts.append("Все смотрят вниз (в телефоны, листы или кубики).")
        } else {
            parts.append("Кто-то смотрит вниз (в телефон или на кубики).")
        }
    } else if neutralCount > 0 || focusedCount > 0 {
        parts.append("Игрок спокойно и внимательно слушает мастера (нейтральное, сосредоточенное выражение лица).")
    }
    
    let summaryText = parts.joined(separator: " ")
    
    return [
        "faces": total,
        "summary": summaryText,
        "attention": lookingDownCount > 0 ? "looking_down" : (lookingAwayCount > 0 ? "looking_away" : (focusedCount > 0 ? "focused" : "mixed")),
        "smiling": smilingCount > 0,
        "tired": tiredCount > 0,
        "neutral": neutralCount > 0 && smilingCount == 0 && tiredCount == 0,
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
