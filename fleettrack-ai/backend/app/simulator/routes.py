"""
Realistic coordinate sequences for 5 simulated construction vehicles across Chennai, India road corridors.
These coordinates trace actual arterial roads:
- Route 1: Guindy Industrial Estate -> Anna Salai -> T. Nagar -> Marina (Dump Truck)
- Route 2: Tambaram Sanatorium -> GST Road -> Chromepet -> Pallavaram (Excavator)
- Route 3: Porur Junction -> Mount-Poonamallee Rd -> Kathipara -> Velachery (Concrete Mixer)
- Route 4: Ambattur Industrial Estate -> Padi Flyover -> Anna Nagar Roundtana (Loader)
- Route 5: Sholinganallur -> OMR IT Expressway -> Perungudi -> Thiruvanmiyur (Crane Truck)
"""

SIMULATED_ROUTES = {
    # Dump Truck TN-01-AB-1234
    "GPS-TRUCK-001": {
        "registration_number": "TN-01-AB-1234",
        "vehicle_type": "dump_truck",
        "base_speed": 42.0,
        "path": [
            {"lat": 13.0067, "lng": 80.2025},  # Guindy Industrial Estate
            {"lat": 13.0125, "lng": 80.2089},  # Kathipara approach
            {"lat": 13.0189, "lng": 80.2165},  # Saidapet
            {"lat": 13.0245, "lng": 80.2241},  # Anna Salai / Nandanam
            {"lat": 13.0310, "lng": 80.2315},  # T. Nagar junction
            {"lat": 13.0385, "lng": 80.2420},  # SIET / Teynampet
            {"lat": 13.0450, "lng": 80.2510},  # Thousand Lights
            {"lat": 13.0520, "lng": 80.2615},  # Spencers Plaza
            {"lat": 13.0580, "lng": 80.2720},  # Anna Flyover
            {"lat": 13.0610, "lng": 80.2810},  # Marina Beach Road / Kamarajar Salai
            {"lat": 13.0530, "lng": 80.2830},  # Santhome High Road
            {"lat": 13.0440, "lng": 80.2815},  # Foreshore Estate
            {"lat": 13.0380, "lng": 80.2740},  # MRC Nagar construction hub
            {"lat": 13.0310, "lng": 80.2610},  # Raja Annamalaipuram
            {"lat": 13.0210, "lng": 80.2450},  # Kotturpuram
            {"lat": 13.0110, "lng": 80.2210},  # Guindy back to hub
        ],
    },
    # Excavator TN-01-CD-5678
    "GPS-EXCV-002": {
        "registration_number": "TN-01-CD-5678",
        "vehicle_type": "excavator",
        "base_speed": 18.0,
        "path": [
            {"lat": 12.9249, "lng": 80.1300},  # Tambaram Sanatorium
            {"lat": 12.9315, "lng": 80.1365},  # GST Road
            {"lat": 12.9410, "lng": 80.1440},  # Chromepet
            {"lat": 12.9520, "lng": 80.1510},  # Pallavaram
            {"lat": 12.9605, "lng": 80.1585},  # Airport approach
            {"lat": 12.9680, "lng": 80.1650},  # Meenambakkam Site
            {"lat": 12.9620, "lng": 80.1610},  # Turnaround
            {"lat": 12.9510, "lng": 80.1500},
            {"lat": 12.9380, "lng": 80.1410},
            {"lat": 12.9280, "lng": 80.1320},
        ],
    },
    # Concrete Mixer TN-01-EF-9012
    "GPS-MIXR-003": {
        "registration_number": "TN-01-EF-9012",
        "vehicle_type": "concrete_mixer",
        "base_speed": 34.0,
        "path": [
            {"lat": 13.0382, "lng": 80.1565},  # Porur Junction
            {"lat": 13.0310, "lng": 80.1680},  # Ramapuram
            {"lat": 13.0220, "lng": 80.1810},  # Butt Road
            {"lat": 13.0100, "lng": 80.1990},  # Kathipara Junction
            {"lat": 12.9980, "lng": 80.2090},  # Guindy Race Course
            {"lat": 12.9860, "lng": 80.2180},  # Velachery Main Road
            {"lat": 12.9780, "lng": 80.2240},  # Phoenix Marketcity area site
            {"lat": 12.9840, "lng": 80.2200},  # Return leg
            {"lat": 12.9960, "lng": 80.2110},
            {"lat": 13.0150, "lng": 80.1900},
            {"lat": 13.0290, "lng": 80.1700},
        ],
    },
    # Loader TN-01-GH-3456
    "GPS-LOAD-004": {
        "registration_number": "TN-01-GH-3456",
        "vehicle_type": "loader",
        "base_speed": 22.0,
        "path": [
            {"lat": 13.1143, "lng": 80.1548},  # Ambattur Industrial Estate
            {"lat": 13.1020, "lng": 80.1700},  # Padi Flyover
            {"lat": 13.0920, "lng": 80.1880},  # Thirumangalam Junction
            {"lat": 13.0850, "lng": 80.2020},  # Anna Nagar Roundtana
            {"lat": 13.0800, "lng": 80.2150},  # Shenoy Nagar Metro site
            {"lat": 13.0830, "lng": 80.2040},  # Turnaround
            {"lat": 13.0910, "lng": 80.1900},
            {"lat": 13.1000, "lng": 80.1720},
            {"lat": 13.1110, "lng": 80.1580},
        ],
    },
    # Crane Truck TN-01-IJ-7890
    "GPS-CRAN-005": {
        "registration_number": "TN-01-IJ-7890",
        "vehicle_type": "crane_truck",
        "base_speed": 30.0,
        "path": [
            {"lat": 12.9010, "lng": 80.2279},  # Sholinganallur Junction
            {"lat": 12.9180, "lng": 80.2350},  # Karapakkam
            {"lat": 12.9350, "lng": 80.2420},  # Thoraipakkam
            {"lat": 12.9550, "lng": 80.2480},  # Perungudi Toll
            {"lat": 12.9680, "lng": 80.2520},  # SRP Tools Junction
            {"lat": 12.9820, "lng": 80.2570},  # Tidel Park / Thiruvanmiyur
            {"lat": 12.9710, "lng": 80.2530},  # Return leg
            {"lat": 12.9480, "lng": 80.2450},
            {"lat": 12.9280, "lng": 80.2380},
            {"lat": 12.9090, "lng": 80.2310},
        ],
    },
}
