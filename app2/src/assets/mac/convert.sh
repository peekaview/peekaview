#! /bin/bash

convert icon.ico -resize 16x16 icon_16x16.png
convert icon.ico -resize 32x32 icon_32x32.png
convert icon.ico -resize 64x64 icon_64x64.png
convert icon.ico -resize 128x128 icon_128x128.png
convert icon.ico -resize 256x256 icon_256x256.png
convert icon.ico -resize 512x512 icon_512x512.png
convert icon.ico -resize 1024x1024 icon_1024x1024.png

mkdir MyIcon.iconset
mv icon_16x16.png MyIcon.iconset/icon_16x16.png
mv icon_32x32.png MyIcon.iconset/icon_32x32.png
mv icon_64x64.png MyIcon.iconset/icon_64x64.png
mv icon_128x128.png MyIcon.iconset/icon_128x128.png
mv icon_256x256.png MyIcon.iconset/icon_256x256.png
mv icon_512x512.png MyIcon.iconset/icon_512x512.png
mv icon_1024x1024.png MyIcon.iconset/icon_1024x1024.png

iconutil -c icns MyIcon.iconset

rm -r MyIcon.iconset

mv MyIcon.icns icon.icns