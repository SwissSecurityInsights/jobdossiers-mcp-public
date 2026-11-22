# Icone

`icon.svg` è il logo JD del portale (`public/favicon.svg` di jobdossiers.ch). Da qui, a mano, le icone delle app:

- `mac/AppIcon.icns` (16–1024 px, con `iconutil`);
- `win/src/Jobdossiers.Win/app.ico` (16–256 px, voci PNG): exe, finestre, area di notifica e installer;
- `extension/icons/icon-{16,32,48,128}.png`: estensione per Chrome ed Edge.

Se il logo cambia: esporta `icon.svg` in PNG 1024×1024, poi ridimensiona con `sips -z` e rigenera i tre insiemi.
