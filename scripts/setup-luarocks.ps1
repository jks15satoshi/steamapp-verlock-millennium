$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$RocksDir = Join-Path $RootDir ".rocks"
$LuaRocksVersion = "3.13.0"
$BuildDir = Join-Path ([System.IO.Path]::GetTempPath()) ("luarocks-build-" + [System.Guid]::NewGuid().ToString("N"))
$Archive = Join-Path $BuildDir "luarocks-$LuaRocksVersion.tar.gz"
$SrcDir = Join-Path $BuildDir "luarocks-$LuaRocksVersion"
$Url = "https://github.com/luarocks/luarocks/archive/refs/tags/v$LuaRocksVersion.tar.gz"

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

try {
  $LuaJitDir = (mise where luajit).Trim()
  $LuaBase = $LuaJitDir
  if (Test-Path (Join-Path $LuaJitDir "Library")) {
    $LuaBase = Join-Path $LuaJitDir "Library"
  }
  $LuaBin = Join-Path $LuaBase "bin"
  $LuaLib = Join-Path $LuaBase "lib"
  $LuaInc = Join-Path $LuaBase "include\luajit-2.1"
  if (-not (Test-Path (Join-Path $LuaInc "lua.h"))) {
    $LuaInc = Join-Path $LuaBase "include"
  }

  if (-not (Test-Path (Join-Path $RocksDir "luarocks.bat"))) {
    Invoke-WebRequest -Uri $Url -OutFile $Archive
    tar -xzf $Archive -C $BuildDir

    Push-Location $SrcDir
    try {
      cmd /c "install.bat /P `"$RocksDir`" /TREE `"$RocksDir`" /BIN `"$LuaBin`" /LIB `"$LuaLib`" /INC `"$LuaInc`" /LV 5.1 /MSVC /NOADMIN /Q /F"
      if ($LASTEXITCODE -ne 0) {
        throw "LuaRocks installer failed with exit code $LASTEXITCODE"
      }
    }
    finally {
      Pop-Location
    }
  }

  & (Join-Path $RocksDir "luarocks.bat") config variables.LUALIB lua51.lib
  if ($LASTEXITCODE -ne 0) {
    throw "LuaRocks config failed with exit code $LASTEXITCODE"
  }

  & (Join-Path $RocksDir "luarocks.bat") make --deps-only (Join-Path $RootDir "steamapp-verlock-dev-1.rockspec")
  if ($LASTEXITCODE -ne 0) {
    throw "LuaRocks make failed with exit code $LASTEXITCODE"
  }
}
finally {
  Remove-Item -Recurse -Force $BuildDir -ErrorAction SilentlyContinue
}
