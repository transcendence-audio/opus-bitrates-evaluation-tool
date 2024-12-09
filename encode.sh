#!/usr/bin/env bash

path=audio/$2

# Controlla se la directory esiste
if [ -d "$path" ]; then
  # Se esiste, pulisce il contenuto
  rm -rf "$path"/*
else
  # Se non esiste, la crea
  mkdir -p "$path"
fi

# Loop per elaborare i bitrate
for BITRATE in 2 6 10 16 32 64 96 128 192 512
do
  opusenc --hard-cbr --max-delay 0 --bitrate $BITRATE $1 $path/$BITRATE.opus
  ffmpeg -i $path/$BITRATE.opus -c copy $path/$BITRATE.webm
done
