require "love.system"

local https_ok
https_ok, HTTPS = pcall(require, 'https')
if not https_ok then HTTPS = nil end
local httpencode = function(str)
    str = str..''
    local char_to_hex = function(c)
        return string.format("%%%02X", string.byte(c))
    end
    str = str:gsub("\n", "\r\n"):gsub("([^%w _%%%-%.~])", char_to_hex):gsub(" ", "+")
    return str
end

if jit and (love.system.getOS() == 'OS X' )and (jit.arch == 'arm64' or jit.arch == 'arm') then jit.off() end

IN_CHANNEL = love.thread.getChannel("http_request")
OUT_CHANNEL = love.thread.getChannel("http_response")

  while true do
    --Monitor the channel for any new requests
    local request = IN_CHANNEL:demand() -- Value from channel
    if request then
    end
end
