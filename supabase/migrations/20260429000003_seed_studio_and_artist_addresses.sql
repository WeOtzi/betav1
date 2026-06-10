-- Seed studio + artist precise addresses for the demo / staging data set
--
-- 1) Backfills the 12 existing studios with real-world addresses + lat/lng.
-- 2) Inserts new studios in the major LatAm cities where We Ötzi has artists
--    so studio-affiliated assignment has options to choose from.
-- 3) Assigns a studio_id (and work_type='studio') to ~half of the artists
--    in each city, and stamps the remainder with work_type='independent'
--    plus a structured personal address.
--
-- All coordinates are real, hand-picked geocoded points. Streets/numbers are
-- realistic for the city (deliberately not the real artist's home — this is
-- demo data) so the map's pins land on plausible spots.

BEGIN;

-- ============================================================
-- 1) Update the 12 existing studios with full structured addresses
-- ============================================================

UPDATE public.studios SET
  country = 'United States', country_code = 'US',
  state_province = 'New York', city = 'New York',
  locality = 'SoHo',
  street = 'Howard Street', street_number = '47', unit = NULL,
  postal_code = '10013',
  formatted_address = '47 Howard St, New York, NY 10013, United States',
  latitude = 40.7195, longitude = -74.0017,
  phone = '+1 212-219-2799', website = 'https://bangbangnyc.com',
  geocoded_at = now(),
  ubicacion = 'New York, United States'
WHERE name = 'Bang Bang NYC';

UPDATE public.studios SET
  country = 'United States', country_code = 'US',
  state_province = 'New York', city = 'New York',
  locality = 'East Village',
  street = 'East 1st Street', street_number = '152',
  postal_code = '10009',
  formatted_address = '152 E 1st St, New York, NY 10009, United States',
  latitude = 40.7234, longitude = -73.9863,
  phone = '+1 212-477-2060', website = 'https://eastsideinknyc.com',
  geocoded_at = now(),
  ubicacion = 'New York, United States'
WHERE name = 'East Side Ink';

UPDATE public.studios SET
  country = 'Argentina', country_code = 'AR',
  state_province = 'Ciudad Autónoma de Buenos Aires', city = 'Buenos Aires',
  locality = 'San Telmo',
  street = 'Defensa', street_number = '986',
  postal_code = 'C1065AAT',
  formatted_address = 'Defensa 986, San Telmo, C1065AAT CABA, Argentina',
  latitude = -34.6212, longitude = -58.3711,
  phone = '+54 11 4361-9521',
  geocoded_at = now(),
  ubicacion = 'Buenos Aires, Argentina'
WHERE name = 'Estudio Sur Ink';

UPDATE public.studios SET
  country = 'Argentina', country_code = 'AR',
  state_province = 'Ciudad Autónoma de Buenos Aires', city = 'Buenos Aires',
  locality = 'Palermo Soho',
  street = 'Honduras', street_number = '5024',
  postal_code = 'C1414BNN',
  formatted_address = 'Honduras 5024, Palermo Soho, C1414BNN CABA, Argentina',
  latitude = -34.5872, longitude = -58.4337,
  phone = '+54 11 4831-2244',
  geocoded_at = now(),
  ubicacion = 'Buenos Aires, Argentina'
WHERE name = 'Palermo Tattoo Club';

UPDATE public.studios SET
  country = 'Argentina', country_code = 'AR',
  state_province = 'Ciudad Autónoma de Buenos Aires', city = 'Buenos Aires',
  locality = 'Recoleta',
  street = 'Avenida Santa Fe', street_number = '1750',
  postal_code = 'C1060ABL',
  formatted_address = 'Av. Santa Fe 1750, Recoleta, C1060ABL CABA, Argentina',
  latitude = -34.5953, longitude = -58.3927,
  phone = '+54 11 4812-9876',
  geocoded_at = now(),
  ubicacion = 'Buenos Aires, Argentina'
WHERE name = 'Tattoo Buenos Aires';

UPDATE public.studios SET
  country = 'Mexico', country_code = 'MX',
  state_province = 'Ciudad de México', city = 'Ciudad de México',
  locality = 'Roma Norte',
  street = 'Colima', street_number = '168',
  postal_code = '06700',
  formatted_address = 'Colima 168, Roma Norte, Cuauhtémoc, 06700 CDMX, México',
  latitude = 19.4178, longitude = -99.1623,
  phone = '+52 55 5208-7745',
  geocoded_at = now(),
  ubicacion = 'Ciudad de Mexico, Mexico'
WHERE name = 'Tinta Negra';

UPDATE public.studios SET
  country = 'Germany', country_code = 'DE',
  state_province = 'Berlin', city = 'Berlin',
  locality = 'Kreuzberg',
  street = 'Oranienstraße', street_number = '23',
  postal_code = '10999',
  formatted_address = 'Oranienstraße 23, 10999 Berlin, Germany',
  latitude = 52.5004, longitude = 13.4188,
  phone = '+49 30 6128-7700',
  geocoded_at = now(),
  ubicacion = 'Berlin, Germany'
WHERE name = 'Inkmania Berlin';

UPDATE public.studios SET
  country = 'New Zealand', country_code = 'NZ',
  state_province = 'Auckland', city = 'Auckland',
  locality = 'Karangahape Road',
  street = 'Karangahape Road', street_number = '297',
  postal_code = '1010',
  formatted_address = '297 Karangahape Rd, Newton, Auckland 1010, New Zealand',
  latitude = -36.8581, longitude = 174.7549,
  phone = '+64 9-377-7711',
  geocoded_at = now(),
  ubicacion = 'Auckland, New Zealand'
WHERE name = 'Sacred Tattoo';

UPDATE public.studios SET
  country = 'United Kingdom', country_code = 'GB',
  state_province = 'England', city = 'London',
  locality = 'Mayfair',
  street = 'Brewer Street', street_number = '29B',
  postal_code = 'W1F 0RY',
  formatted_address = '29B Brewer St, London W1F 0RY, United Kingdom',
  latitude = 51.5113, longitude = -0.1373,
  phone = '+44 20 7287-3777', website = 'https://sangbleu.com',
  geocoded_at = now(),
  ubicacion = 'London, United Kingdom'
WHERE name = 'Sang Bleu London';

UPDATE public.studios SET
  country = 'United Kingdom', country_code = 'GB',
  state_province = 'England', city = 'London',
  locality = 'Fitzrovia',
  street = 'Charlotte Street', street_number = '7',
  postal_code = 'W1T 1RG',
  formatted_address = '7 Charlotte St, London W1T 1RG, United Kingdom',
  latitude = 51.5183, longitude = -0.1349,
  phone = '+44 20 7580-2090',
  geocoded_at = now(),
  ubicacion = 'London, United Kingdom'
WHERE name = 'Seven Doors Tattoo';

UPDATE public.studios SET
  country = 'Argentina', country_code = 'AR',
  state_province = 'Ciudad Autónoma de Buenos Aires', city = 'Buenos Aires',
  locality = 'Villa Crespo',
  street = 'Avenida Corrientes', street_number = '5450',
  postal_code = 'C1414AJD',
  formatted_address = 'Av. Corrientes 5450, Villa Crespo, C1414AJD CABA, Argentina',
  latitude = -34.5995, longitude = -58.4438,
  geocoded_at = now(),
  ubicacion = 'Buenos Aires, Argentina'
WHERE name = 'CLAROSCURO';

UPDATE public.studios SET
  country = 'Argentina', country_code = 'AR',
  state_province = 'Ciudad Autónoma de Buenos Aires', city = 'Buenos Aires',
  locality = 'Almagro',
  street = 'Avenida Medrano', street_number = '852',
  postal_code = 'C1179AAB',
  formatted_address = 'Av. Medrano 852, Almagro, C1179AAB CABA, Argentina',
  latitude = -34.6092, longitude = -58.4216,
  geocoded_at = now(),
  ubicacion = 'Buenos Aires, Argentina'
WHERE name = 'claroscuro laboratorio de arte';

-- ============================================================
-- 2) Add new studios in the major cities where artists live
-- ============================================================

INSERT INTO public.studios (
  name, normalized_name, ubicacion,
  country, country_code, state_province, city, locality,
  street, street_number, postal_code, formatted_address,
  latitude, longitude, phone, geocoded_at
) VALUES
-- Mexico
('La Aguja Negra', 'LA AGUJA NEGRA', 'Guadalajara, Mexico',
 'Mexico', 'MX', 'Jalisco', 'Guadalajara', 'Colonia Americana',
 'Av. Vallarta', '1488', '44160', 'Av. Vallarta 1488, Americana, 44160 Guadalajara, Jal., México',
 20.6713, -103.3676, '+52 33 3825-1234', now()),
('Norte Tinta', 'NORTE TINTA', 'Monterrey, Mexico',
 'Mexico', 'MX', 'Nuevo León', 'Monterrey', 'Centro',
 'Calle Padre Mier', '350', '64000', 'Padre Mier 350, Centro, 64000 Monterrey, N.L., México',
 25.6716, -100.3098, '+52 81 8345-6677', now()),
-- Colombia
('Bogotá Black Ink', 'BOGOTA BLACK INK', 'Bogota, Colombia',
 'Colombia', 'CO', 'Cundinamarca', 'Bogotá', 'Chapinero',
 'Carrera 13', '53-78', '110231', 'Cra. 13 #53-78, Chapinero, Bogotá, Colombia',
 4.6428, -74.0674, '+57 1 211-3344', now()),
('Comuna 13 Tattoo', 'COMUNA 13 TATTOO', 'Medellin, Colombia',
 'Colombia', 'CO', 'Antioquia', 'Medellín', 'El Poblado',
 'Carrera 37', '8A-50', '050021', 'Cra. 37 #8A-50, El Poblado, Medellín, Colombia',
 6.2086, -75.5680, '+57 4 268-9911', now()),
('Cali Sur Tattoo', 'CALI SUR TATTOO', 'Cali, Colombia',
 'Colombia', 'CO', 'Valle del Cauca', 'Cali', 'San Antonio',
 'Calle 4 Oeste', '3-67', '760001', 'Cl. 4 Oeste #3-67, San Antonio, Cali, Colombia',
 3.4376, -76.5419, '+57 2 893-2244', now()),
-- Brazil
('Paulista Ink', 'PAULISTA INK', 'Sao Paulo, Brasil',
 'Brasil', 'BR', 'São Paulo', 'São Paulo', 'Vila Madalena',
 'Rua Aspicuelta', '565', '05433-010', 'R. Aspicuelta 565, Vila Madalena, São Paulo - SP, 05433-010, Brasil',
 -23.5563, -46.6915, '+55 11 3814-7700', now()),
-- Chile
('Bellavista Tattoo', 'BELLAVISTA TATTOO', 'Santiago, Chile',
 'Chile', 'CL', 'Región Metropolitana', 'Santiago', 'Bellavista',
 'Pío Nono', '270', '7520143', 'Pío Nono 270, Recoleta, Santiago, Chile',
 -33.4279, -70.6334, '+56 2 2737-5566', now()),
('Cerro Alegre Ink', 'CERRO ALEGRE INK', 'Valparaiso, Chile',
 'Chile', 'CL', 'Valparaíso', 'Valparaíso', 'Cerro Alegre',
 'Almirante Montt', '254', '2360110', 'Almirante Montt 254, Cerro Alegre, Valparaíso, Chile',
 -33.0394, -71.6280, '+56 32 259-7711', now()),
-- Peru
('Lima Tinta Studio', 'LIMA TINTA STUDIO', 'Lima, Peru',
 'Peru', 'PE', 'Lima', 'Lima', 'Miraflores',
 'Av. Larco', '1150', '15074', 'Av. Larco 1150, Miraflores 15074, Perú',
 -12.1306, -77.0298, '+51 1 446-2233', now()),
-- Uruguay
('Pocitos Tattoo Club', 'POCITOS TATTOO CLUB', 'Montevideo, Uruguay',
 'Uruguay', 'UY', 'Montevideo', 'Montevideo', 'Pocitos',
 '21 de Setiembre', '2845', '11300', '21 de Setiembre 2845, Pocitos, 11300 Montevideo, Uruguay',
 -34.9075, -56.1494, '+598 2 712-3344', now()),
-- Ecuador
('Quito Norte Ink', 'QUITO NORTE INK', 'Quito, Ecuador',
 'Ecuador', 'EC', 'Pichincha', 'Quito', 'La Floresta',
 'Av. 12 de Octubre', 'N24-562', '170143', 'Av. 12 de Octubre N24-562, Quito 170143, Ecuador',
 -0.2042, -78.4895, '+593 2 256-7788', now()),
-- Argentina (Cordoba & Rosario, in addition to BA already covered)
('Córdoba Norte Tattoo', 'CORDOBA NORTE TATTOO', 'Cordoba, Argentina',
 'Argentina', 'AR', 'Córdoba', 'Córdoba', 'Nueva Córdoba',
 'Av. Hipólito Yrigoyen', '565', 'X5000', 'Av. H. Yrigoyen 565, Nueva Córdoba, X5000 Córdoba, Argentina',
 -31.4225, -64.1851, '+54 351 423-5566', now()),
('Pichincha Tattoo Rosario', 'PICHINCHA TATTOO ROSARIO', 'Rosario, Argentina',
 'Argentina', 'AR', 'Santa Fe', 'Rosario', 'Pichincha',
 'Salta', '2950', 'S2002', 'Salta 2950, Pichincha, S2002 Rosario, Santa Fe, Argentina',
 -32.9381, -60.6589, '+54 341 426-7788', now())
ON CONFLICT (normalized_name) DO NOTHING;

-- ============================================================
-- 3) Assign studios to artists based on city
-- ============================================================
-- Strategy: in each city, assign ~half of the artists to the city's studio
-- with work_type='studio'. The rest become 'independent' with their own
-- structured address (next step).

WITH ranked AS (
  SELECT
    a.user_id,
    a.city,
    a.country,
    s.id AS chosen_studio_id,
    s.latitude AS s_lat, s.longitude AS s_lng,
    ROW_NUMBER() OVER (PARTITION BY a.city ORDER BY a.user_id) AS rn,
    COUNT(*) OVER (PARTITION BY a.city) AS city_n
  FROM public.artists_db a
  LEFT JOIN LATERAL (
    SELECT s2.id, s2.latitude, s2.longitude
    FROM public.studios s2
    WHERE s2.city ILIKE a.city
       OR (a.city ILIKE 'CDMX' AND s2.city ILIKE 'Ciudad de México')
       OR (a.city ILIKE 'Ciudad de Mexico' AND s2.city ILIKE 'Ciudad de México')
    ORDER BY s2.created_at
    LIMIT 1
  ) s ON true
  WHERE a.city IS NOT NULL
    AND a.city <> ''
)
UPDATE public.artists_db a
SET
  studio_id = r.chosen_studio_id,
  work_type = 'studio',
  -- Clear personal address fields when affiliated to a studio (the view
  -- ignores them anyway, but it's cleaner for any direct queries).
  latitude  = NULL,
  longitude = NULL,
  geocoded_at = NULL
FROM ranked r
WHERE a.user_id = r.user_id
  AND r.chosen_studio_id IS NOT NULL
  AND r.rn <= GREATEST(1, r.city_n / 2);  -- about half per city

-- ============================================================
-- 4) For the rest (with city + null studio), set independent + address
-- ============================================================
-- Generate plausible street + house number based on city.

WITH targets AS (
  SELECT
    user_id, city, country,
    -- Fallback street for each known city. For anything unknown, the city
    -- name itself goes in formatted_address.
    CASE city
      WHEN 'Buenos Aires' THEN 'Calle Tucumán'
      WHEN 'Cordoba'      THEN 'Calle Independencia'
      WHEN 'Rosario'      THEN 'Calle Sarmiento'
      WHEN 'Acassuso'     THEN 'Av. del Libertador'
      WHEN 'CDMX'         THEN 'Calle Álvaro Obregón'
      WHEN 'Ciudad de Mexico' THEN 'Calle Álvaro Obregón'
      WHEN 'Guadalajara'  THEN 'Av. La Paz'
      WHEN 'Monterrey'    THEN 'Calle Hidalgo'
      WHEN 'Bogota'       THEN 'Carrera 7'
      WHEN 'Medellin'     THEN 'Calle 10'
      WHEN 'Cali'         THEN 'Avenida 6N'
      WHEN 'Sao Paulo'    THEN 'Rua Augusta'
      WHEN 'Santiago'     THEN 'Av. Providencia'
      WHEN 'Valparaiso'   THEN 'Calle Esmeralda'
      WHEN 'Lima'         THEN 'Av. Pardo'
      WHEN 'Montevideo'   THEN 'Av. 18 de Julio'
      WHEN 'Quito'        THEN 'Av. Amazonas'
      ELSE 'Calle Principal'
    END AS street,
    -- Locality / barrio
    CASE city
      WHEN 'Buenos Aires' THEN 'San Telmo'
      WHEN 'CDMX'         THEN 'Condesa'
      WHEN 'Ciudad de Mexico' THEN 'Condesa'
      WHEN 'Guadalajara'  THEN 'Colonia Americana'
      WHEN 'Monterrey'    THEN 'Centro'
      WHEN 'Bogota'       THEN 'La Candelaria'
      WHEN 'Medellin'     THEN 'El Poblado'
      WHEN 'Cali'         THEN 'San Antonio'
      WHEN 'Sao Paulo'    THEN 'Consolação'
      WHEN 'Santiago'     THEN 'Providencia'
      WHEN 'Valparaiso'   THEN 'Cerro Alegre'
      WHEN 'Lima'         THEN 'Miraflores'
      WHEN 'Montevideo'   THEN 'Cordón'
      WHEN 'Quito'        THEN 'La Mariscal'
      WHEN 'Cordoba'      THEN 'Centro'
      WHEN 'Rosario'      THEN 'Centro'
      ELSE NULL
    END AS locality,
    -- City coords as a base, jittered per artist below
    CASE city
      WHEN 'Buenos Aires' THEN -34.6037
      WHEN 'Cordoba'      THEN -31.4201
      WHEN 'Rosario'      THEN -32.9442
      WHEN 'Acassuso'     THEN -34.4944
      WHEN 'CDMX'         THEN 19.4326
      WHEN 'Ciudad de Mexico' THEN 19.4326
      WHEN 'Guadalajara'  THEN 20.6597
      WHEN 'Monterrey'    THEN 25.6866
      WHEN 'Bogota'       THEN 4.7110
      WHEN 'Medellin'     THEN 6.2442
      WHEN 'Cali'         THEN 3.4516
      WHEN 'Sao Paulo'    THEN -23.5505
      WHEN 'Santiago'     THEN -33.4489
      WHEN 'Valparaiso'   THEN -33.0472
      WHEN 'Lima'         THEN -12.0464
      WHEN 'Montevideo'   THEN -34.9011
      WHEN 'Quito'        THEN -0.1807
      ELSE NULL
    END AS city_lat,
    CASE city
      WHEN 'Buenos Aires' THEN -58.3816
      WHEN 'Cordoba'      THEN -64.1888
      WHEN 'Rosario'      THEN -60.6505
      WHEN 'Acassuso'     THEN -58.5012
      WHEN 'CDMX'         THEN -99.1332
      WHEN 'Ciudad de Mexico' THEN -99.1332
      WHEN 'Guadalajara'  THEN -103.3496
      WHEN 'Monterrey'    THEN -100.3161
      WHEN 'Bogota'       THEN -74.0721
      WHEN 'Medellin'     THEN -75.5812
      WHEN 'Cali'         THEN -76.5320
      WHEN 'Sao Paulo'    THEN -46.6333
      WHEN 'Santiago'     THEN -70.6693
      WHEN 'Valparaiso'   THEN -71.6127
      WHEN 'Lima'         THEN -77.0428
      WHEN 'Montevideo'   THEN -56.1645
      WHEN 'Quito'        THEN -78.4678
      ELSE NULL
    END AS city_lng,
    ROW_NUMBER() OVER (PARTITION BY city ORDER BY user_id) AS rn
  FROM public.artists_db
  WHERE studio_id IS NULL
    AND city IS NOT NULL
    AND btrim(city) <> ''
)
UPDATE public.artists_db a
SET
  work_type         = 'independent',
  street            = t.street,
  street_number     = (100 + (t.rn * 47) % 1900)::TEXT, -- pseudo-random house numbers
  locality          = t.locality,
  formatted_address = t.street || ' ' || (100 + (t.rn * 47) % 1900)::TEXT
                     || COALESCE(', ' || t.locality, '')
                     || ', ' || a.city
                     || COALESCE(', ' || a.country, ''),
  -- Jitter coordinates ±0.02° (~2km) so independents don't all land
  -- exactly on the city centre.
  latitude  = CASE WHEN t.city_lat IS NULL THEN a.latitude
                   ELSE t.city_lat + ((t.rn * 13) % 41 - 20) * 0.001
              END,
  longitude = CASE WHEN t.city_lng IS NULL THEN a.longitude
                   ELSE t.city_lng + ((t.rn * 17) % 41 - 20) * 0.001
              END,
  geocoded_at = now()
FROM targets t
WHERE a.user_id = t.user_id;

-- ============================================================
-- 5) Anything still missing a work_type (artists with no city) → independent
-- ============================================================
UPDATE public.artists_db
SET work_type = 'independent'
WHERE work_type IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
