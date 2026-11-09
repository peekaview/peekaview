; PeekaView: on a real uninstall (not an update), also remove the PeekaView service
; ("Auch ohne Anmeldung"). The app is installed per user; removing a service needs
; administrator rights, so Windows asks (UAC).
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ClearErrors
    ReadRegStr $R9 HKLM "SYSTEM\CurrentControlSet\Services\PeekaViewService" "ImagePath"
    ${IfNot} ${Errors}
      ExecShellWait "runas" "$INSTDIR\${MAINBINARYNAME}.exe" "--uninstall-service" SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend
