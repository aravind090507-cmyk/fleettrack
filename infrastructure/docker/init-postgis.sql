-- PostgreSQL + PostGIS Initialization Script
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'DRIVER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. Vehicles Table
CREATE TABLE IF NOT EXISTS vehicles (
    id VARCHAR(36) PRIMARY KEY,
    registration_number VARCHAR(64) UNIQUE NOT NULL,
    model VARCHAR(128) NOT NULL,
    vehicle_type VARCHAR(64) NOT NULL DEFAULT 'VAN',
    assigned_driver_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    battery_or_fuel_level FLOAT DEFAULT 100.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vehicles_registration ON vehicles(registration_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

-- 3. Journeys Table
CREATE TABLE IF NOT EXISTS journeys (
    id VARCHAR(36) PRIMARY KEY,
    vehicle_id VARCHAR(36) NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    origin_name VARCHAR(255) NOT NULL,
    origin_lat FLOAT NOT NULL,
    origin_lng FLOAT NOT NULL,
    destination_name VARCHAR(255) NOT NULL,
    destination_lat FLOAT NOT NULL,
    destination_lng FLOAT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    description TEXT,
    total_distance_km FLOAT DEFAULT 0.0,
    duration_seconds INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_journeys_vehicle ON journeys(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_journeys_driver ON journeys(driver_id);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON journeys(status);

-- 4. Locations Table (with PostGIS Spatial Point)
CREATE TABLE IF NOT EXISTS locations (
    id BIGSERIAL PRIMARY KEY,
    journey_id VARCHAR(36) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    speed FLOAT NOT NULL DEFAULT 0.0,
    heading FLOAT NOT NULL DEFAULT 0.0,
    accuracy FLOAT NOT NULL DEFAULT 0.0,
    altitude FLOAT,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    server_received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_locations_journey_time ON locations(journey_id, recorded_at ASC);

-- 5. Tracking Links Table (Hashed Ephemeral Tokens)
CREATE TABLE IF NOT EXISTS tracking_links (
    id VARCHAR(36) PRIMARY KEY,
    journey_id VARCHAR(36) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    access_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracking_links_token ON tracking_links(token_hash);

-- 6. Trip Events Table
CREATE TABLE IF NOT EXISTS trip_events (
    id VARCHAR(36) PRIMARY KEY,
    journey_id VARCHAR(36) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trip_events_journey ON trip_events(journey_id);
