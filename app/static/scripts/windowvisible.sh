#!/bin/bash
# Check if a window is covered by more than 20%
# Usage: ./xcovered.sh <window-id>

wid=$1
if [ -z "$wid" ]; then
    #echo "Usage: $0 <window-id>"
    exit 1
fi

# Convert the given window ID to hexadecimal (if it's not already)
if [[ ! "$wid" =~ ^0x ]]; then
    wid=$(printf "0x%x" "$wid")
    #echo "Converted window ID to hexadecimal: $wid"
fi

# Check if the window is viewable
if ! xwininfo -id "$wid" -stats | grep -q 'IsViewable'; then
    #echo "Window ID $wid is not viewable."
    exit 0
fi

# Get stacking order
stacking_order=($(xprop -root _NET_CLIENT_LIST_STACKING | grep -o "0x[0-9a-fA-F]\+" | grep -v "^0x0"))
if [ "${#stacking_order[@]}" -eq 0 ]; then
    #echo "Error: Could not retrieve stacking order."
    exit 1
fi

#echo "Stacking order: ${stacking_order[@]}"

# Find windows above the target in stacking order
above_windows=()
found_target=false

for window in "${stacking_order[@]}"; do
    if [ "$window" == "$wid" ]; then
        found_target=true
        #echo "Found target window $wid in stacking order."
    elif $found_target; then
        above_windows+=("$window")
    fi
done

if ! $found_target; then
    #echo "Error: Target window $wid not found in stacking order."
    exit 1
fi

if [ "${#above_windows[@]}" -eq 0 ]; then
    #echo "No windows above target window $wid in stacking order."
    #echo "Window ID $wid is not covered more than 20%."
    exit 0
fi

# Get the geometry of the target window
target_geometry=($(xwininfo -id "$wid" | awk '
    /Absolute upper-left X:/ { x=$NF }
    /Absolute upper-left Y:/ { y=$NF }
    /Width:/ { w=$NF }
    /Height:/ { h=$NF }
    END { print x, y, w, h }'))

if [ "${#target_geometry[@]}" -ne 4 ]; then
    #echo "Error: Could not retrieve target window geometry."
    exit 1
fi

window_x=${target_geometry[0]}
window_y=${target_geometry[1]}
window_width=${target_geometry[2]}
window_height=${target_geometry[3]}
window_area=$((window_width * window_height))

#exit 1
#echo "Target window geometry: X=$window_x, Y=$window_y, Width=$window_width, Height=$window_height, Area=$window_area"

# Add this new function after the initial checks
get_window_name() {
    local wid=$1
    xprop -id "$wid" WM_NAME 2>/dev/null | sed 's/WM_NAME(STRING) = "\(.*\)"/\1/'
}

# Gather geometry of windows above the target window
declare -a coords
for owid in "${above_windows[@]}"; do
    # Get window name and check if it starts with __peekaview or peekaview - (case insensitive)
    window_name=$(get_window_name "$owid")
    if [[ "${window_name,,}" =~ ^(__peekaview|peekaview\ -) ]]; then
        continue  # Skip this window
    fi
    
    if xwininfo -id "$owid" -stats | grep -q 'IsViewable'; then
        x=($(xwininfo -id "$owid" -stats | awk '
            /Absolute upper-left X:/ { x=$NF }
            /Absolute upper-left Y:/ { y=$NF }
            /Width:/ { w=$NF }
            /Height:/ { h=$NF }
            END { print x, y, w, h }'))
        if [ "${#x[@]}" -ne 4 ]; then
            #echo "Error parsing geometry of window ID $owid"
            exit 1
        fi
        coords+=("${x[@]}")
        #echo "Added geometry for window $owid: ${x[@]}"
    fi
done

# Overlap function to calculate intersection area
calculate_overlap() {
    local x1=$1 y1=$2 w1=$3 h1=$4
    local x2=$5 y2=$6 w2=$7 h2=$8

    # Calculate overlap width and height
    local x_overlap=$(( $(($x1 + $w1 < $x2 + $w2 ? $x1 + $w1 : $x2 + $w2)) - \
                         $(($x1 > $x2 ? $x1 : $x2)) ))
    local y_overlap=$(( $(($y1 + $h1 < $y2 + $h2 ? $y1 + $h1 : $y2 + $h2)) - \
                         $(($y1 > $y2 ? $y1 : $y2)) ))

    # Return the area of the overlap
    if [ "$x_overlap" -le 0 ] || [ "$y_overlap" -le 0 ]; then
        echo 0
    else
        echo $((x_overlap * y_overlap))
    fi
}

# Calculate total overlap area
total_area=0
for ((i=0; i<${#coords[@]}; i+=4)); do
    #echo "Checking overlap with window: X=${coords[i]}, Y=${coords[i+1]}, Width=${coords[i+2]}, Height=${coords[i+3]}"
    overlap_area=$(calculate_overlap "$window_x" "$window_y" "$window_width" "$window_height" \
                                    "${coords[i]}" "${coords[i+1]}" "${coords[i+2]}" "${coords[i+3]}")
    #echo "Overlap area: $overlap_area"
    total_area=$((total_area + overlap_area))
done

# Final total area covered
#echo "Total overlap area: $total_area"

# Calculate percentage of coverage
coverage_percentage=$((100 * total_area / window_area))
#echo "Coverage percentage: $coverage_percentage%"

# Check if the window is covered more than 20%
if [ "$coverage_percentage" -gt 10 ]; then
    echo "0"
else
    echo "1"
fi