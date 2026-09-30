# Acceso e identidad de estudios — guía de prueba

## Registro y acceso

En https://beta.weotzi.com/studio/register/ registrá el correo del estudio. Si se solicita confirmar el correo, abrí el mensaje y volvé a iniciar sesión: el registro puede retomarse sin crear otra cuenta o duplicar el estudio. El dashboard espera la inicialización de Supabase antes de comprobar la sesión.

En https://beta.weotzi.com/studio/login/ podés recuperar el acceso mediante código o enlace de Supabase. Los cambios de contraseña desde la cuenta requieren una sesión válida.

## Perfil y sedes

Completá identidad, descripción, contacto, enlaces y ubicación del estudio. Agregá una sede y verificá que permanezca después de recargar. Podés definir una sede principal activa; no se permite eliminarla o desactivarla sin resolver primero la sede principal. El guardado de ubicación y estudio se hace en una transacción para evitar estados parciales.

Los enlaces públicos se validan y el perfil respeta la visibilidad del estudio y de sus sedes. Probá la vista pública después de guardar los cambios.

## Roster y spots

Invitá a un artista desde Roster y aceptá desde su cuenta. Verificá el estado pendiente, el resultado de aceptación y el roster activo. Las notificaciones informan fallos de correo sin perder la invitación guardada.

Publicá un spot, postulá con una cuenta de artista y resolvé la postulación desde el estudio. Aceptar actualiza de forma atómica la postulación, la membresía y la proyección heredada del artista; repetir la operación no duplica miembros. Las decisiones y sus correos se validan contra el estado guardado y la propiedad del estudio.

## Evidencia técnica

Diez pruebas de identidad y las transacciones SQL con rollback cubren continuación del registro, sede principal, rollback de sedes, propietario ajeno, aceptación atómica y preservación del alta de catálogos sin dueño. Se verificó interfaz a 1440 y 390 px. La prueba autenticada publicada validó acceso al dashboard y persistencia de factura; los datos sintéticos se retiraron al finalizar.

Continuá con la [guía de operaciones](STUDIOS-OPERATIONS-20260921.md) para agenda, trabajos, clientes, facturas, documentos, inventario, proveedores, sponsors, Travel y métricas.
