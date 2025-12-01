"""
Calcul du score de qualité de l'air intérieur (IAQ Score)
Simple et facile à comprendre
"""


def calculate_iaq_score(data: dict) -> dict:
    """
    Calcule un score global IAQ de 0 à 100 (100 = excellent)
    
    Args:
        data: dict avec co2, pm25, tvoc, temperature, humidity
        
    Returns:
        dict avec global_score et global_level
    """
    # Seuils recommandés (OMS, ANSES, EPA)
    THRESHOLDS = {
        "co2": {"excellent": 600, "good": 1000, "moderate": 1400, "poor": 2000},
        "pm25": {"excellent": 12, "good": 25, "moderate": 50, "poor": 100},
        "tvoc": {"excellent": 200, "good": 300, "moderate": 500, "poor": 1000},
        "humidity": {"excellent": (40, 50), "good": (30, 60), "moderate": (20, 70)},
        "temperature": {"excellent": (19, 22), "good": (18, 24), "moderate": (16, 26)}
    }
    
    scores = []
    
    # Score CO2
    co2 = float(data.get("co2", 400))
    if co2 <= THRESHOLDS["co2"]["excellent"]:
        scores.append(100)
    elif co2 <= THRESHOLDS["co2"]["good"]:
        scores.append(80)
    elif co2 <= THRESHOLDS["co2"]["moderate"]:
        scores.append(60)
    elif co2 <= THRESHOLDS["co2"]["poor"]:
        scores.append(40)
    else:
        scores.append(20)
    
    # Score PM2.5
    pm25 = float(data.get("pm25", 5))
    if pm25 <= THRESHOLDS["pm25"]["excellent"]:
        scores.append(100)
    elif pm25 <= THRESHOLDS["pm25"]["good"]:
        scores.append(80)
    elif pm25 <= THRESHOLDS["pm25"]["moderate"]:
        scores.append(60)
    elif pm25 <= THRESHOLDS["pm25"]["poor"]:
        scores.append(40)
    else:
        scores.append(20)
    
    # Score TVOC
    tvoc = float(data.get("tvoc", 100))
    if tvoc <= THRESHOLDS["tvoc"]["excellent"]:
        scores.append(100)
    elif tvoc <= THRESHOLDS["tvoc"]["good"]:
        scores.append(80)
    elif tvoc <= THRESHOLDS["tvoc"]["moderate"]:
        scores.append(60)
    elif tvoc <= THRESHOLDS["tvoc"]["poor"]:
        scores.append(40)
    else:
        scores.append(20)
    
    # Score Humidité
    humidity = float(data.get("humidity", 45))
    hum_min, hum_max = THRESHOLDS["humidity"]["excellent"]
    if hum_min <= humidity <= hum_max:
        scores.append(100)
    elif THRESHOLDS["humidity"]["good"][0] <= humidity <= THRESHOLDS["humidity"]["good"][1]:
        scores.append(80)
    elif THRESHOLDS["humidity"]["moderate"][0] <= humidity <= THRESHOLDS["humidity"]["moderate"][1]:
        scores.append(60)
    else:
        scores.append(40)
    
    # Score Température
    temp = float(data.get("temperature", 21))
    temp_min, temp_max = THRESHOLDS["temperature"]["excellent"]
    if temp_min <= temp <= temp_max:
        scores.append(100)
    elif THRESHOLDS["temperature"]["good"][0] <= temp <= THRESHOLDS["temperature"]["good"][1]:
        scores.append(80)
    elif THRESHOLDS["temperature"]["moderate"][0] <= temp <= THRESHOLDS["temperature"]["moderate"][1]:
        scores.append(60)
    else:
        scores.append(40)
    
    # Moyenne des scores
    global_score = sum(scores) / len(scores) if scores else 0
    
    # Niveau global
    if global_score >= 90:
        level = "excellent"
    elif global_score >= 70:
        level = "good"
    elif global_score >= 50:
        level = "moderate"
    elif global_score >= 30:
        level = "poor"
    else:
        level = "very_poor"
    
    return {
        "global_score": round(global_score),
        "global_level": level
    }
