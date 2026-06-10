WITH new_styles(name, slug, sort_offset) AS (
  VALUES
    ('Black & Grey', 'black-grey', 1),
    ('Microrealismo', 'microrealismo', 2),
    ('Hiperrealismo', 'hiperrealismo', 3),
    ('Ornamental', 'ornamental', 4),
    ('Mandala', 'mandala', 5),
    ('Tribal', 'tribal', 6),
    ('Polinesio', 'polinesio', 7),
    ('Maori', 'maori', 8),
    ('Haida', 'haida', 9),
    ('Celta', 'celta', 10),
    ('Nordico / Viking', 'nordico-viking', 11),
    ('Lettering', 'lettering', 12),
    ('Blackletter / Gotico', 'blackletter-gotico', 13),
    ('Caligrafia', 'caligrafia', 14),
    ('Ignorant', 'ignorant', 15),
    ('Handpoke / Stick and Poke', 'handpoke-stick-and-poke', 16),
    ('Abstracto', 'abstracto', 17),
    ('Sketch / Boceto', 'sketch-boceto', 18),
    ('Etching / Grabado', 'etching-grabado', 19),
    ('Woodcut / Xilografia', 'woodcut-xilografia', 20),
    ('Linework', 'linework', 21),
    ('Ilustracion botanica', 'ilustracion-botanica', 22),
    ('Floral', 'floral', 23),
    ('Fineline botanico', 'fineline-botanico', 24),
    ('Biomecanico', 'biomecanico', 25),
    ('Bioorganico', 'bioorganico', 26),
    ('Horror', 'horror', 27),
    ('Dark Art', 'dark-art', 28),
    ('Glitch', 'glitch', 29),
    ('Pixel Art', 'pixel-art', 30),
    ('Graffiti', 'graffiti', 31),
    ('Pop Art', 'pop-art', 32),
    ('Art Nouveau', 'art-nouveau', 33),
    ('Art Deco', 'art-deco', 34),
    ('Barroco', 'barroco', 35),
    ('Abstract Brush', 'abstract-brush', 36),
    ('Patchwork', 'patchwork', 37),
    ('Religious / Sacro', 'religious-sacro', 38),
    ('Ornamental Blackwork', 'ornamental-blackwork', 39),
    ('Pointillism', 'pointillism', 40)
),
max_sort AS (
  SELECT COALESCE(MAX(sort_order), 0) AS value
  FROM public.tattoo_styles
  WHERE parent_id IS NULL
)
INSERT INTO public.tattoo_styles (name, slug, parent_id, sort_order, substyles_display_mode)
SELECT
  new_styles.name,
  new_styles.slug,
  NULL,
  max_sort.value + new_styles.sort_offset,
  'grouped'
FROM new_styles
CROSS JOIN max_sort
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tattoo_styles existing
  WHERE existing.parent_id IS NULL
    AND lower(existing.name) = lower(new_styles.name)
);
