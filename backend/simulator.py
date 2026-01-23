import time
import random
import logging
import json
import math
from datetime import datetime, timedelta
import sys
import os

# Add parent directory to path to allow imports from backend
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.core.influx_client import get_influx_client, write_data
from backend.utils import load_config
from backend.core.settings import settings

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("Simulator")

# Physics Constants
OUTDOOR_CO2 = 400.0
OUTDOOR_TEMP = 15.0  # Celsius
OUTDOOR_PM25 = 5.0
OUTDOOR_TVOC = 10.0
OUTDOOR_HUMIDITY = 50.0

# Room Defaults
DEFAULT_VOLUME = 50.0 # m3

class RoomState:
    def __init__(self, enseigne_id, room_id, capteur_id):
        self.enseigne_id = enseigne_id
        self.room_id = room_id
        self.capteur_id = capteur_id
        
        # Initial values
        self.co2 = 450.0
        self.temp = 20.0
        self.humidity = 45.0
        self.pm25 = 10.0
        self.tvoc = 50.0
        
        # People presence (random simulation)
        self.people_count = 0
        self.last_people_change = datetime.now()

    def update(self, modules, dt_seconds=5):
        """
        Update physical values based on modules state and physics
        Modules structure: list of dicts {type, state, ...}
        """
        
        # 1. Determine influences
        window_open = False
        hvac_on = False
        hvac_target = 21.0
        door_open = False
        
        for mod in modules:
            m_type = mod.get("type")
            state = mod.get("state")
            
            if m_type == "window" and state == "open":
                window_open = True
            elif m_type == "door" and state == "open":
                door_open = True
            elif m_type == "hvac" and state == "on":
                hvac_on = True
                if "target_temp" in mod:
                    hvac_target = float(mod["target_temp"])

        # 2. Simulate People (Random walk)
        if (datetime.now() - self.last_people_change).total_seconds() > 300: # Change every 5 mins
            if random.random() > 0.5:
                self.people_count = random.randint(0, 3)
            self.last_people_change = datetime.now()

        # 3. Apply Physic Rules
        
        # CO2 Physics
        # Generation: ~0.005 L/s per person => scaled to ppm increase
        # Delta ppm = (Generation - Ventilation) * dt / Volume
        
        generation = self.people_count * 2.0 * dt_seconds # simplified increase per tick
        
        ventilation_rate = 0.05 # natural leakage
        if window_open:
            ventilation_rate += 2.0 # Huge exchange if window open
        if door_open:
            ventilation_rate += 0.5
            
        # Mix with outdoor
        diff_outdoor = OUTDOOR_CO2 - self.co2
        change_vent = diff_outdoor * (ventilation_rate * dt_seconds / DEFAULT_VOLUME)
        
        self.co2 += generation + change_vent
        self.co2 = max(400, self.co2) # Floor
        
        # Temperature Physics
        thermal_loss = 0.01
        if window_open:
            thermal_loss += 0.5
            
        diff_temp_out = OUTDOOR_TEMP - self.temp
        change_temp = diff_temp_out * (thermal_loss * dt_seconds / DEFAULT_VOLUME)
        
        # HVAC
        if hvac_on:
            power = 0.5 # degrees per tick max
            diff_target = hvac_target - self.temp
            # move towards target
            if abs(diff_target) < power * dt_seconds:
                self.temp = hvac_target
            else:
                self.temp += math.copysign(power * dt_seconds, diff_target)
        
        self.temp += change_temp
        
        # Humidity
        # Tends towards outdoor (if windows open) or stable
        hum_change = (OUTDOOR_HUMIDITY - self.humidity) * (ventilation_rate * 0.1 * dt_seconds / DEFAULT_VOLUME)
        self.humidity += hum_change
        
        # Random Noise
        self.co2 += random.uniform(-2, 2)
        self.temp += random.uniform(-0.05, 0.05)
        self.humidity += random.uniform(-0.1, 0.1)
        self.pm25 += random.uniform(-0.5, 0.5)
        self.tvoc += random.uniform(-1, 1)

        # Ensure bounds
        self.pm25 = max(0, self.pm25)
        self.tvoc = max(0, self.tvoc)

    def get_data_point(self):
        return {
            "measurement": "iaq_raw",
            "tags": {
                "enseigne": self.enseigne_id,
                "salle": self.room_id,
                "sensor_id": self.capteur_id
            },
            "fields": {
                "co2": float(self.co2),
                "temperature": float(self.temp),
                "humidity": float(self.humidity),
                "pm25": float(self.pm25),
                "tvoc": float(self.tvoc),
                "people": int(self.people_count)
            },
            "time": datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
        }

def run_simulation():
    logger.info("Starting Simulator...")
    client = get_influx_client() # Ensure we can connect early
    
    room_states = {} # key: unique_room_id -> RoomState

    while True:
        try:
            config = load_config()
            
            points_batch = []
            
            if "lieux" in config and "enseignes" in config["lieux"]:
                for ens in config["lieux"]["enseignes"]:
                    ens_nom = ens.get("nom", "Unknown")
                    ens_id = ens.get("id")
                    
                    for piece in ens.get("pieces", []):
                        piece_nom = piece.get("nom", "Unknown")
                        piece_id = piece.get("id")
                        
                        # Find sensor ID (first one)
                        capteur_id = "default"
                        if "capteurs" in piece and len(piece["capteurs"]) > 0:
                            capteur_id = piece["capteurs"][0]
                        else:
                            # If no sensor defined, skip or simulate one?
                            capteur_id = f"{piece_nom}_sensor"
                            
                        unique_id = f"{ens_id}_{piece_id}"
                        
                        if unique_id not in room_states:
                            logger.info(f"Initializing state for {ens_nom} - {piece_nom}")
                            room_states[unique_id] = RoomState(ens_nom, piece_nom, capteur_id)
                        
                        # Get Modules
                        modules = piece.get("modules", [])
                        
                        # Update State
                        room_states[unique_id].update(modules)
                        
                        # Collect Data
                        points_batch.append(room_states[unique_id].get_data_point())
            
            # Write Batch
            if points_batch:
                success = write_data(points_batch)
                if success:
                    logger.info(f"Simulated {len(points_batch)} rooms. Example CO2: {points_batch[0]['fields']['co2']:.1f}")
                else:
                    logger.error("Failed to write to InfluxDB")
            
            time.sleep(5)
            
        except Exception as e:
            logger.error(f"Simulation Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    run_simulation()
