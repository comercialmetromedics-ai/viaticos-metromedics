# Viáticos · Metromedics S.A.S

App para que el personal de campo reporte sus viáticos por orden de servicio (ej. `4120-CAL-MMCS`) y el administrador los revise, controle consignaciones y vea indicadores.

- **Una sola app web instalable (PWA):** el técnico la usa en el celular (Android o iPhone) y el administrador en el PC. Cada uno ve lo suyo según su usuario.
- **Backend:** Supabase (base de datos PostgreSQL, usuarios, fotos de facturas y RUT).
- **Publicación:** GitHub Pages (gratis). Cada cambio subido a `main` se publica solo.

---

## 1. Base de datos (una sola vez)

1. En supabase.com abre el proyecto → **SQL Editor** → **New query**.
2. Pega **todo** el contenido de `supabase/schema.sql` y pulsa **Run**. Debe terminar con *Success*.
3. Ve a **Authentication → Sign In / Providers → Email** y desactiva **Confirm email**. Así los técnicos entran apenas el administrador los activa; la activación ya es el control de acceso.
4. En **Authentication → URL Configuration**, en *Site URL*, pon la dirección donde quede publicada la app (paso 2).

## 2. Publicar la app

1. Sube esta carpeta a un repositorio de GitHub de la empresa (por ejemplo `viaticos-metromedics`).
2. En el repositorio: **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**, crea:
   - `SUPABASE_URL` = la *Project URL* de Supabase
   - `SUPABASE_ANON_KEY` = la clave *anon public* de Supabase
3. **Settings → Pages → Source: GitHub Actions**.
4. Pestaña **Actions → Publicar app → Run workflow**. En 1–2 minutos queda en
   `https://<usuario>.github.io/viaticos-metromedics/`.

> Nunca pongas la clave **service_role** en el repositorio ni en la app.

## 3. Primer administrador

1. Abre la app, toca **Crear cuenta** y regístrate con tu correo.
2. En Supabase → SQL Editor ejecuta (con tu correo):
   ```sql
   update public.perfiles set rol = 'admin', activo = true where email = 'tu-correo@ejemplo.com';
   ```
3. Entra a la app: verás el **panel administrador**. Desde **Usuarios** activas a cada técnico después de que cree su cuenta.

## 4. Instalar en el celular

- **Android (Chrome):** abrir la dirección → menú ⋮ → *Instalar app* / *Agregar a pantalla principal*.
- **iPhone (Safari):** abrir la dirección → botón Compartir → *Agregar a pantalla de inicio*.

## Cómo funciona

| Regla | Dónde se controla |
|---|---|
| Solo el **responsable** de la orden reporta sus gastos; quien crea la orden queda como responsable | Base de datos (no se puede saltar desde la app) |
| Soporte obligatorio; **RUT obligatorio** si no es factura electrónica | Base de datos |
| **Hora límite** por día (L–V, sábado, domingo); lo tardío queda *extemporáneo* o se bloquea | Ajustes · base de datos |
| Topes por concepto y ciudad (hotel × noches) | Ajustes |
| Aprobar total, aprobar hasta el tope o rechazar con motivo; el técnico corrige y **reenvía el mismo reporte** | Por revisar · Novedades |
| Consignaciones siempre al responsable actual; cambio de responsable con traspaso de saldo | Viáticos entregados |
| Cada técnico ve solo sus reportes, saldos y fotos | Seguridad por fila (RLS) |

## Desarrollo local

```bash
cp .env.example .env   # y pega URL y clave anon
npm install
npm run dev
```

Pruebas: `test/flujo.sql` prueba reglas y permisos en un PostgreSQL local (`test/supabase_stub.sql` simula Supabase); `test/ui_test.py` recorre la interfaz con datos simulados.

## Legalización y estados de cuenta

- **Legalizar:** en *Viáticos entregados*, cada fila abierta (técnico + orden) tiene el botón **Legalizar** cuando no quedan reportes por revisar. Muestra recibido, aprobado, no aprobado y el resultado (reintegra / reembolsar); se registra cómo se saldó y opcionalmente el comprobante. Los rechazados sin corregir pasan como **no aprobados**. Todo lo legalizado queda bloqueado y el saldo vuelve a cero.
- **Legalizaciones:** historial con acta imprimible (PDF) y descarga a Excel.
- **Estados de cuenta:** resumen general (quién debe reintegrar, a quién reembolsar) y movimientos por técnico con saldo acumulado; descargables e imprimibles.
- **Órdenes:** historial de visitas/legalizaciones por orden; archivar las que ya no se usan.
- Base de datos: si el proyecto ya tenía `schema.sql`, ejecutar una vez `supabase/migracion_002_legalizacion.sql`. En un proyecto nuevo basta `schema.sql` (ya la incluye).

## Pendiente (fase 2)

- Notificaciones push con la app cerrada (hoy los avisos del plazo salen con la app abierta y como notificación del sistema si el técnico las activa).
- Modo sin señal: guardar el reporte en el celular y enviarlo al volver la conexión.
- Calendario de festivos para el horario de reporte.
