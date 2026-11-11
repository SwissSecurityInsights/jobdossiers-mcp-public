; Installer di Jobdossiers per Windows (NSIS). Solo per l'utente corrente, senza diritti di amministratore.
; App e server vanno in %LOCALAPPDATA%\Jobdossiers, lo stesso percorso a cui puntano i client MCP (ServerHost.Installed).
; Uso: makensis -DVERSION=0.1.0 -DSRC=<cartella con Jobdossiers.exe e jobdossiers-mcp.exe> -DOUT=<Setup.exe> jobdossiers.nsi
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"

!define APP "Jobdossiers"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jobdossiers"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Jobdossiers"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1040 "ProductName" "${APP}"
VIAddVersionKey /LANG=1040 "FileDescription" "Installazione di ${APP}"
VIAddVersionKey /LANG=1040 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1040 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1040 "CompanyName" "Swiss Security Insights"
VIAddVersionKey /LANG=1040 "LegalCopyright" "Swiss Security Insights"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Installa l'app di Jobdossiers per l'area di notifica e il server MCP che permette a Claude, ChatGPT e altri assistenti di leggere le tue candidature.$\r$\n$\r$\nL'installazione vale solo per il tuo utente e non richiede diritti di amministratore."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Jobdossiers.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Avvia Jobdossiers"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Italian"

Section "Jobdossiers"
  ; Un'eventuale versione in esecuzione blocca i file: si chiude prima di sovrascriverli.
  nsExec::Exec 'taskkill /IM Jobdossiers.exe /F'
  Sleep 800
  SetOutPath "$INSTDIR"
  File "${SRC}\Jobdossiers.exe"
  ; Se un client MCP sta usando il server, il file è bloccato: NSIS propone di riprovare dopo averlo chiuso.
  File "${SRC}\jobdossiers-mcp.exe"
  File "${SRC}\LEGGIMI.txt"
  WriteUninstaller "$INSTDIR\Disinstalla.exe"

  CreateShortcut "$SMPROGRAMS\Jobdossiers.lnk" "$INSTDIR\Jobdossiers.exe"
  WriteRegStr HKCU "${RUNKEY}" "Jobdossiers" '"$INSTDIR\Jobdossiers.exe"'

  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Swiss Security Insights"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\Jobdossiers.exe"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Disinstalla.exe"'
  WriteRegStr HKCU "${UNINST}" "QuietUninstallString" '"$INSTDIR\Disinstalla.exe" /S'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST}" "EstimatedSize" 170000
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Jobdossiers.exe /F'
  Sleep 800
  ; Toglie la voce jobdossiers dai client MCP che puntano a questo server e l'avvio all'accesso.
  ExecWait '"$INSTDIR\Jobdossiers.exe" --cleanup'
  MessageBox MB_YESNO|MB_ICONQUESTION "Eliminare anche la chiave per automazioni salvata su questo computer?$\r$\n$\r$\nPer revocarla davvero usa anche la pagina Account di Jobdossiers." /SD IDNO IDNO keepkey
    Delete "$APPDATA\jobdossiers-mcp\key.dpapi"
    RMDir "$APPDATA\jobdossiers-mcp"
  keepkey:
  Delete "$APPDATA\Jobdossiers\settings.json"
  RMDir "$APPDATA\Jobdossiers"
  Delete "$SMPROGRAMS\Jobdossiers.lnk"
  Delete /REBOOTOK "$INSTDIR\Jobdossiers.exe"
  Delete /REBOOTOK "$INSTDIR\jobdossiers-mcp.exe"
  Delete "$INSTDIR\LEGGIMI.txt"
  Delete "$INSTDIR\Disinstalla.exe"
  RMDir /REBOOTOK "$INSTDIR"
  DeleteRegValue HKCU "${RUNKEY}" "Jobdossiers"
  DeleteRegKey HKCU "${UNINST}"
SectionEnd
