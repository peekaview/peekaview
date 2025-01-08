import { notarize } from '@electron/notarize';

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') {
        return;
    }

    const appName = context.packager.appInfo.productFilename;

    return await notarize({
        tool: 'notarytool',
        teamId: process.env.APPLETEAMID,
        appBundleId: 'com.limtec.peekaview',
        appPath: `${appOutDir}/${appName}.app`,
        appleId: process.env.APPLEID,
        appleIdPassword: process.env.APPLEIDPASS,
    });
};
// evtl auch angucken: https://github.com/electron/electron/issues/31496