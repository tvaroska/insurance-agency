-- Initialization SQL for Evergreen Insurance Agency PostgreSQL Databases
-- Executed automatically by postgres:16-alpine via /docker-entrypoint-initdb.d/

SELECT 'CREATE DATABASE ams' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ams')\gexec
SELECT 'CREATE DATABASE rater' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rater')\gexec
SELECT 'CREATE DATABASE crm' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'crm')\gexec
SELECT 'CREATE DATABASE ecm' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ecm')\gexec
SELECT 'CREATE DATABASE comm' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'comm')\gexec
SELECT 'CREATE DATABASE carrier_summit' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'carrier_summit')\gexec
SELECT 'CREATE DATABASE carrier_coastal' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'carrier_coastal')\gexec
SELECT 'CREATE DATABASE claims' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'claims')\gexec

GRANT ALL PRIVILEGES ON DATABASE ams TO evergreen;
GRANT ALL PRIVILEGES ON DATABASE rater TO evergreen;
GRANT ALL PRIVILEGES ON DATABASE crm TO evergreen;
GRANT ALL PRIVILEGES ON DATABASE ecm TO evergreen;
GRANT ALL PRIVILEGES ON DATABASE comm TO evergreen;
GRANT ALL PRIVILEGES ON DATABASE carrier_summit TO evergreen;
GRANT ALL PRIVILEGES ON DATABASE carrier_coastal TO evergreen;
GRANT ALL PRIVILEGES ON DATABASE claims TO evergreen;
