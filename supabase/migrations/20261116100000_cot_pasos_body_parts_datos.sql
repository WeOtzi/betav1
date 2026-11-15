-- Ronda 2 · cot-pasos (P11): datos de body_parts para el paso "¿Dónde quieres
-- llevarlo?" del cotizador (/quotation). La ficha de cada zona muestra nivel de
-- dolor, subpartes y datos de la zona; la silueta necesita una parte por región.
--
--   1. Columna nueva body_parts.fun_fact (dato curioso, opcional). Hereda el
--      SELECT público de la tabla (RLS "Public read access"); la escritura sigue
--      siendo solo de soporte (body_parts_support_write).
--   2. Subpartes que faltaban para la silueta: Clavícula y Esternón (torso),
--      Espinilla (pierna) y Espalda Media (espalda).
--   3. Orden de arriba hacia abajo dentro de torso, pierna y espalda.
--   4. Textos (descripción, ideal para, cómo se siente, dato curioso) SOLO donde
--      la columna estaba vacía o tenía el texto de prueba de "brazo". Lo que ya
--      cargó soporte no se pisa.
--
-- Idempotente: se puede correr más de una vez sin cambiar nada la segunda.
-- Reversa: supabase/rollbacks/20261116100000_cot_pasos_body_parts_datos.down.sql
begin;

alter table public.body_parts add column if not exists fun_fact text;
comment on column public.body_parts.fun_fact is
    'Dato curioso de la zona para el cotizador (opcional). Texto público.';

-- 2. Subpartes nuevas (part_id es único).
insert into public.body_parts (part_id, label, parent_id, sides, sensitivity, pain_level, sort_order)
select v.part_id, v.label, p.id, v.sides, v.pain, v.pain, 99
from (values
    ('clavicula', 'Clavícula', 'torso', 'both', 8),
    ('esternon', 'Esternón', 'torso', 'none', 9),
    ('espinilla', 'Espinilla', 'pierna', 'both', 8),
    ('espalda_media', 'Espalda Media', 'espalda', 'none', 5)
) as v(part_id, label, parent_part, sides, pain)
join public.body_parts p on p.part_id = v.parent_part and p.parent_id is null
on conflict (part_id) do nothing;

-- 3. Orden de arriba hacia abajo en las zonas tocadas.
update public.body_parts b
set sort_order = v.sort_order
from (values
    ('clavicula', 1),
    ('pecho', 2),
    ('esternon', 3),
    ('costillas', 4),
    ('abdomen', 5),
    ('costado', 6),
    ('cadera', 7),
    ('gluteo', 1),
    ('muslo', 2),
    ('rodilla', 3),
    ('espinilla', 4),
    ('pantorrilla', 5),
    ('tobillo', 6),
    ('pie', 7),
    ('dedos_pie', 8),
    ('espalda_alta', 1),
    ('omoplato', 2),
    ('columna', 3),
    ('espalda_media', 4),
    ('espalda_baja', 5)
) as v(part_id, sort_order)
where b.part_id = v.part_id
  and b.sort_order is distinct from v.sort_order;

-- 4. Textos: solo donde falta (o está el texto de prueba).
update public.body_parts b
set description = case when v.description is not null and coalesce(btrim(b.description), '') = '' then v.description else b.description end,
    tattoo_info = case when v.tattoo_info is not null and coalesce(btrim(b.tattoo_info), '') in ('', 'Otro ejemplosas') then v.tattoo_info else b.tattoo_info end,
    experience_info = case when v.experience_info is not null and coalesce(btrim(b.experience_info), '') in ('', 'Otro ejemplo as asa') then v.experience_info else b.experience_info end,
    fun_fact = case when v.fun_fact is not null and coalesce(btrim(b.fun_fact), '') = '' then v.fun_fact else b.fun_fact end
from (values
    ('brazo', null, 'Mangas completas o medias mangas, y piezas que conectan hombro, brazo y antebrazo.', 'Dolor moderado en general; sube en el codo, la muñeca, la mano y la cara interna del brazo.', 'La «manga» se llama así porque cubre el brazo como la manga de una camisa: suele llevar entre 6 y 10 sesiones.'),
    ('hombro', null, null, null, 'El hombro casi no cambia con las variaciones de peso: es de las zonas donde un tatuaje se mantiene más estable con los años.'),
    ('brazo_superior', 'La cara externa del brazo es carnosa y cómoda de tatuar; la interna es más sensible.', 'Piezas medianas y grandes, retratos y medias mangas.', 'Dolor bajo (4/10) por fuera; la cara interna, cerca de la axila, molesta bastante más.', 'Es la zona clásica del primer tatuaje: cicatriza con poco roce y se oculta con una manga corta.'),
    ('codo', 'Piel gruesa y móvil justo sobre el hueso.', 'Diseños circulares que acompañan la forma: mandalas, telarañas, flores y rosetas.', 'Dolor alto (8/10): la vibración se siente en el hueso y la piel tarda más en cicatrizar por el movimiento.', 'La telaraña en el codo es uno de los grandes clásicos del tatuaje tradicional.'),
    ('antebrazo', null, null, null, 'Por convención el diseño se orienta para verse al derecho con el brazo relajado, de cara a los demás.'),
    ('muneca', null, null, null, 'Por el roce con relojes, pulseras y el lavado de manos, la muñeca suele pedir un retoque antes que otras zonas.'),
    ('mano', 'Zona muy visible, de piel fina y en uso constante.', 'Diseños simples y de líneas firmes; los detalles muy finos se pierden con el tiempo.', 'Dolor alto (8/10): poca grasa y muchos huesos y tendones.', 'La piel de la mano se renueva rápido: es de las zonas donde la tinta se desgasta antes y más retoques necesita.'),
    ('dedos_mano', 'Espacio mínimo y piel que se renueva muy rápido.', 'Símbolos, iniciales, anillos y letras pequeñas.', 'Dolor muy alto (9/10), pero breve: son sesiones cortas.', 'Los tatuajes en los dedos casi siempre necesitan retoques: la tinta se aclara con el uso diario.'),
    ('pierna', 'La pierna reúne zonas muy distintas: del muslo, amplio y poco sensible, a la rodilla y el pie, más exigentes.', 'Piezas grandes, composiciones verticales y mangas de pierna.', 'El dolor cambia mucho según la subparte: bajo en el muslo, alto en la rodilla, la espinilla y el pie.', 'Una manga de pierna completa puede llevar tantas sesiones como una espalda.'),
    ('gluteo', 'Zona amplia y carnosa, fácil de ocultar.', 'Piezas grandes que conectan el muslo con la espalda baja.', 'Dolor bajo (4/10), aunque sentarse resulta incómodo los primeros días.', 'En el estilo japonés tradicional el glúteo forma parte del traje completo, junto con la espalda.'),
    ('muslo', null, null, null, 'Es la zona favorita para piezas grandes y detalladas: mucho espacio plano y poca exposición al sol.'),
    ('rodilla', 'Piel gruesa y en movimiento constante sobre la rótula.', 'Diseños circulares que acompañan la forma: mandalas, flores, rostros.', 'Dolor alto (8/10) y cicatrización más lenta por el movimiento; es normal que se hinche.', 'La parte de atrás de la rodilla es de las zonas más sensibles de todo el cuerpo.'),
    ('espinilla', 'Cara frontal de la pierna, con el hueso muy cerca de la piel.', 'Diseños verticales y alargados: dagas, flores, figuras.', 'Dolor alto (8/10): la vibración se siente directo en la tibia.', 'Es una superficie plana y larga: las piezas verticales se leen de un vistazo.'),
    ('pantorrilla', 'Zona musculosa en la parte de atrás de la pierna.', 'Piezas medianas y grandes, retratos y diseños que envuelven la pierna.', 'Dolor moderado (6/10); más intenso cerca del tendón de Aquiles y detrás de la rodilla.', 'Cicatriza bien y se deforma poco: es una zona muy noble para un primer tatuaje grande.'),
    ('tobillo', 'Zona pequeña, huesuda y delicada.', 'Diseños pequeños, tobilleras y detalles finos.', 'Dolor alto (8/10) sobre el hueso; conviene evitar el calzado ajustado mientras cicatriza.', 'El roce de medias y zapatos es su mayor enemigo durante las primeras semanas.'),
    ('pie', 'Empeine de piel fina, con poco tejido sobre los huesos.', 'Diseños alargados que siguen el empeine y líneas simples.', 'Dolor alto (8/10) y cicatrización exigente: se hincha y pide unos días sin calzado cerrado.', 'Por el roce y el sudor, la tinta del pie tiende a desgastarse y a pedir retoque.'),
    ('dedos_pie', 'Espacio mínimo y mucha fricción.', 'Símbolos y detalles muy pequeños.', 'Dolor muy alto (9/10), aunque son trabajos breves.', 'Es de las zonas donde menos dura la tinta: el roce con el calzado la va aclarando.'),
    ('torso', 'El frente del cuerpo, del pecho a la cadera, con zonas planas y otras muy sensibles.', 'Piezas grandes y simétricas, o composiciones que conectan pecho, costillas y abdomen.', 'Dolor de moderado a alto: sube en las costillas, el esternón y la clavícula.', 'La respiración mueve toda la zona: el artista trabaja siguiendo tu ritmo al inhalar y exhalar.'),
    ('clavicula', 'Línea huesuda y muy visible entre el cuello y el hombro.', 'Frases, ramas, flores finas y diseños que siguen la línea del hueso.', 'Dolor alto (8/10): casi no hay tejido entre la piel y el hueso.', 'Es una favorita del lettering y el fine line porque el hueso enmarca el diseño.'),
    ('pecho', null, null, null, 'Un tatuaje que cubre el pecho de lado a lado se suele planear simétrico, con el esternón como eje.'),
    ('esternon', 'Centro del pecho, justo sobre el hueso.', 'Diseños simétricos y ornamentales: mandalas, joyas, flores.', 'Dolor muy alto (9/10): hueso, poca grasa y la vibración de la respiración.', 'Es de las zonas más pedidas para diseños ornamentales simétricos.'),
    ('costillas', null, null, null, 'Respirar mueve la piel, así que el artista sincroniza cada línea con tu respiración.'),
    ('abdomen', 'Zona blanda y amplia en el centro del torso.', 'Piezas medianas y grandes, simétricas o que rodean el ombligo.', 'Dolor moderado-alto (7/10): la piel es elástica y cuesta mantenerla tensa.', 'Es la zona que más cambia con el peso o un embarazo: conviene tenerlo en cuenta al elegir el diseño.'),
    ('costado', 'Lateral del torso, entre las costillas y la cadera.', 'Diseños verticales, florales y frases largas.', 'Dolor alto (8/10), sobre todo cerca de las costillas.', 'Suele quedar oculto con la ropa: ideal para un tatuaje grande y discreto.'),
    ('cadera', 'Curva entre la cintura y el muslo.', 'Flores, ornamentos y piezas que bajan hacia el muslo.', 'Dolor moderado (6/10); aumenta sobre el hueso de la cadera.', 'Los diseños que acompañan la curva de la cadera se integran con el movimiento del cuerpo.'),
    ('espalda', 'El lienzo más grande del cuerpo: plano, amplio y poco expuesto al sol.', 'Piezas grandes y detalladas, espaldas completas y composiciones simétricas.', 'Dolor moderado en general; sube sobre la columna, los omóplatos y la zona lumbar.', 'Una espalda completa suele llevar entre 6 y 10 sesiones.'),
    ('espalda_alta', 'Zona amplia entre los hombros, debajo del cuello.', 'Alas, frases, mandalas y piezas simétricas.', 'Dolor moderado (6/10); más intenso cerca del cuello y la columna.', 'Se luce con la espalda descubierta y se oculta con cualquier camiseta.'),
    ('omoplato', 'Superficie plana sobre el hueso, a cada lado de la espalda.', 'Piezas medianas: flores, animales y retratos.', 'Dolor moderado (5/10); se siente más justo sobre el hueso.', 'Es de las zonas que mejor conservan el tatuaje: recibe poco sol y poco roce.'),
    ('columna', 'Línea central de la espalda, sobre las vértebras.', 'Diseños verticales: frases, fases lunares, flores y ornamentos.', 'Dolor muy alto (9/10): hueso y muchas terminaciones nerviosas.', 'Un diseño sobre la columna alarga visualmente la espalda.'),
    ('espalda_media', 'Parte central de la espalda, a la altura de las costillas.', 'Piezas grandes o la continuación de una espalda completa.', 'Dolor moderado (5/10); aumenta hacia las costillas y la columna.', 'Es una de las superficies más planas del cuerpo: los detalles finos quedan muy parejos.'),
    ('espalda_baja', 'Zona lumbar, sobre la cintura.', 'Diseños horizontales y simétricos, sobre todo ornamentales.', 'Dolor alto (8/10) cerca de la columna y de los huesos de la cadera.', 'Fue la zona estrella de los años 2000 y hoy vuelve con diseños ornamentales.'),
    ('cabeza', 'Cuello, nuca, rostro y cráneo: las zonas más visibles del cuerpo.', 'Diseños pensados para verse siempre; conviene elegirlos con calma.', 'Dolor alto en general: piel fina, hueso cerca y mucha sensibilidad.', 'Muchos artistas solo tatúan rostro o cuello a personas que ya tienen otros tatuajes.'),
    ('cuello', 'Frente y laterales del cuello, de piel fina y muy visible.', 'Diseños pequeños y medianos, lettering y ornamentos.', 'Dolor alto (8/10); la garganta es la parte más sensible.', 'El lateral del cuello suele tolerarse mejor que la garganta.'),
    ('nuca', 'Parte de atrás del cuello, bajo la línea del cabello.', 'Símbolos, frases cortas y diseños pequeños y verticales.', 'Dolor muy alto (9/10) sobre las vértebras; suele ser un trabajo breve.', 'Con el cabello suelto queda oculta; recogido, se luce.'),
    ('detras_oreja', 'Rincón pequeño de piel fina sobre el hueso.', 'Símbolos mínimos, iniciales y flores pequeñas.', 'Dolor muy alto (9/10) y vibración intensa: la máquina se oye muy cerca.', 'Es de los tatuajes más discretos: basta soltar el cabello para ocultarlo.'),
    ('craneo', 'Cuero cabelludo, sobre el hueso del cráneo.', 'Diseños que se adaptan a la forma de la cabeza; hay que afeitar la zona.', 'Dolor máximo (10/10): la vibración se siente en toda la cabeza.', 'Si dejas crecer el cabello, el tatuaje queda oculto por completo.'),
    ('cara', 'La zona más visible y la de mayor compromiso.', 'Diseños pequeños y muy pensados.', 'Dolor muy alto (9/10): piel fina y muchas terminaciones nerviosas.', 'Muchos estudios piden una charla previa antes de aceptar un tatuaje en el rostro.')
) as v(part_id, description, tattoo_info, experience_info, fun_fact)
where b.part_id = v.part_id
  and (
      (v.description is not null and coalesce(btrim(b.description), '') = '')
      or (v.tattoo_info is not null and coalesce(btrim(b.tattoo_info), '') in ('', 'Otro ejemplosas'))
      or (v.experience_info is not null and coalesce(btrim(b.experience_info), '') in ('', 'Otro ejemplo as asa'))
      or (v.fun_fact is not null and coalesce(btrim(b.fun_fact), '') = '')
  );

commit;
