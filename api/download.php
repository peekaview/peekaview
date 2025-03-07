<?php

/**
 * Detects the user's operating system and architecture
 * @return array with 'os', 'arch', and 'linux_type' keys
 */
function detectUserSystem() {
    $userAgent = $_SERVER['HTTP_USER_AGENT'];
    $result = [
        'os' => null,
        'arch' => null,
        'linux_type' => null
    ];
    
    // Detect OS
    if (strpos($userAgent, 'Windows') !== false) {
        $result['os'] = 'win';
    } elseif (strpos($userAgent, 'Macintosh') !== false || strpos($userAgent, 'Mac OS X') !== false) {
        $result['os'] = 'mac';
    } elseif (strpos($userAgent, 'Linux') !== false) {
        $result['os'] = 'linux';
        
        // Try to detect Linux distribution type
        if (strpos($userAgent, 'Ubuntu') !== false || 
            strpos($userAgent, 'Debian') !== false || 
            strpos($userAgent, 'Mint') !== false) {
            $result['linux_type'] = 'debian';
        } elseif (strpos($userAgent, 'Fedora') !== false || 
                 strpos($userAgent, 'RHEL') !== false || 
                 strpos($userAgent, 'CentOS') !== false) {
            $result['linux_type'] = 'rpm';
        } else {
            $result['linux_type'] = 'other';
        }
    }
    
    // Detect architecture
    if (strpos($userAgent, 'x86_64') !== false || strpos($userAgent, 'x64') !== false || strpos($userAgent, 'Win64') !== false || strpos($userAgent, 'x86-64') !== false) {
        $result['arch'] = 'x64';
    } elseif (strpos($userAgent, 'i686') !== false || strpos($userAgent, 'i386') !== false || strpos($userAgent, 'x86') !== false) {
        $result['arch'] = 'ia32';
    } elseif (strpos($userAgent, 'arm64') !== false || strpos($userAgent, 'aarch64') !== false) {
        $result['arch'] = 'arm64';
    }
    
    return $result;
}

/**
 * Parses the latest.yml file to extract download information
 * @param string $ymlContent The content of the latest.yml file
 * @return array Parsed information including version and files
 */
function parseYml($ymlContent) {
    $result = [
        'version' => null,
        'files' => []
    ];
    
    $lines = explode("\n", $ymlContent);
    
    foreach ($lines as $line) {
        // Extract version
        if (strpos($line, 'version:') === 0) {
            $result['version'] = trim(substr($line, 9));
        }
        
        // Extract file information
        if (strpos($line, '  - url:') === 0) {
            $url = trim(substr($line, 9));
            $fileInfo = ['url' => $url];
            
            // Parse file name to determine OS and architecture
            $fileInfo['os'] = null;
            $fileInfo['arch'] = null;
            
            if (strpos($url, '-win-x64') !== false) {
                $fileInfo['os'] = 'win';
                $fileInfo['arch'] = 'x64';
            } elseif (strpos($url, '-win-ia32') !== false) {
                $fileInfo['os'] = 'win';
                $fileInfo['arch'] = 'ia32';
            } elseif (strpos($url, '-win') !== false) {
                $fileInfo['os'] = 'win';
                // Default Windows without specific architecture
            } elseif (strpos($url, '-mac-x64') !== false) {
                $fileInfo['os'] = 'mac';
                $fileInfo['arch'] = 'x64';
            } elseif (strpos($url, '-mac-arm64') !== false) {
                $fileInfo['os'] = 'mac';
                $fileInfo['arch'] = 'arm64';
            } elseif (strpos($url, '-mac') !== false) {
                $fileInfo['os'] = 'mac';
                // Default Mac without specific architecture
            } elseif (strpos($url, '-linux-x64') !== false) {
                $fileInfo['os'] = 'linux';
                $fileInfo['arch'] = 'x64';
            } elseif (strpos($url, '-linux') !== false) {
                $fileInfo['os'] = 'linux';
                // Default Linux without specific architecture
            }
            
            $result['files'][] = $fileInfo;
        }
    }
    
    return $result;
}

/**
 * Gets the appropriate download URL based on user's system
 * @return string The download URL
 */
function getDownloadLink() {
    $userSystem = detectUserSystem();
    
    // Determine which YML file to use based on detected OS
    $ymlFile = 'latest.yml'; // Default for Windows
    
    if ($userSystem['os'] === 'mac') {
        $ymlFile = 'latest-mac.yml';
    } elseif ($userSystem['os'] === 'linux') {
        $ymlFile = 'latest-linux.yml';
    }
    
    $ymlUrl = 'https://github.com/peekaview/peekaview/releases/latest/download/' . $ymlFile;
    $ymlContent = file_get_contents($ymlUrl);
    
    if (!$ymlContent) {
        return null;
    }
    
    $parsedYml = parseYml($ymlContent);
    
    // Base GitHub release URL
    $baseUrl = 'https://github.com/peekaview/peekaview/releases/latest/download/';
    
    // Find the best matching file for the user's system
    $bestMatch = null;
    $fallbackMatch = null;
    
    // First pass: find architecture matches with preferred file format
    foreach ($parsedYml['files'] as $file) {
        $fileUrl = $file['url'];
        
        // Check if architecture matches
        if ($file['arch'] === $userSystem['arch'] || $file['arch'] === null) {
            // For Mac, prefer DMG
            if ($userSystem['os'] === 'mac' && strpos($fileUrl, '.dmg') !== false) {
                $bestMatch = $file;
                break;
            }
            
            // For Linux, check distribution type
            if ($userSystem['os'] === 'linux') {
                if ($userSystem['linux_type'] === 'debian' && strpos($fileUrl, '.deb') !== false) {
                    $bestMatch = $file;
                    break;
                } elseif ($userSystem['linux_type'] === 'rpm' && strpos($fileUrl, '.rpm') !== false) {
                    $bestMatch = $file;
                    break;
                } elseif ($userSystem['linux_type'] === 'other' && strpos($fileUrl, '.AppImage') !== false) {
                    $bestMatch = $file;
                    break;
                }
            }
            
            // Save as fallback if no preferred format is found
            if ($fallbackMatch === null) {
                $fallbackMatch = $file;
            }
        }
    }
    
    // If no preferred format found, use fallback
    if ($bestMatch === null) {
        $bestMatch = $fallbackMatch;
    }
    
    // If still no match, use the first file as last resort
    if ($bestMatch === null && !empty($parsedYml['files'])) {
        $bestMatch = $parsedYml['files'][0];
    }
    
    if ($bestMatch) {
        return $baseUrl . $bestMatch['url'];
    }
    
    return null;
}

// Handle the download request
$downloadUrl = getDownloadLink();

if ($downloadUrl) {
    // Redirect to the appropriate download URL
    header("Location: $downloadUrl");
    exit;
} else {
    // Error handling
    header("HTTP/1.1 404 Not Found");
    echo "Download not available. Please try again later.";
}