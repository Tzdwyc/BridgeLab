@echo off
rem Close the old BridgeLab server window first. Keep the old browser origin for migration.
set "BRIDGELAB_PORT=5195"
call "%~dp0启动BridgeLab-v0.3.7.cmd"

