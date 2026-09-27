/* ============================================================
   CONFIGURACIÓN DE LAS CUENTAS
   ============================================================
   Rellena estos dos valores con los de tu proyecto de Supabase.
   Los encuentras en el panel, en Project Settings, API Keys.

   Mientras estén vacíos, la app funciona igual pero sin cuentas:
   cada persona guarda su entrenamiento en su propio navegador.

   La clave anon es pública a propósito, va en el código de la
   página y no da acceso a nada por sí sola. Lo que protege los
   datos son las políticas RLS del archivo supabase.sql.
   La que NO se pone aquí nunca es la service_role.
   ============================================================ */
window.CUADERNO_SUPABASE = {
  url: "",
  anonKey: ""
};
