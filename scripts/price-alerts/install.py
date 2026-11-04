"""Install the local APNs delivery agent. Pass a working Supabase CLI binary."""
import argparse
import os
import json
from pathlib import Path
import plistlib
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cli', default=shutil.which('supabase'), required=not shutil.which('supabase'))
args = parser.parse_args()
node = shutil.which('node')
if not node:
    parser.error('node is required')
source = Path(__file__).resolve().parent
root = Path.home() / 'Library/Application Support/FuelUpPriceAlerts'
for name in ('scripts/price-alerts', 'scripts/driving-research', 'supabase/functions/_shared', 'bin'):
    (root / name).mkdir(mode=0o700, parents=True, exist_ok=True)
root.chmod(0o700)
shutil.copy2(source / 'worker.mjs', root / 'scripts/price-alerts')
shutil.copy2(source.parent / 'driving-research/apns.mjs', root / 'scripts/driving-research')
shutil.copy2(source.parents[1]/'supabase/functions/_shared/priceAlertPayload.mjs', root/'supabase/functions/_shared')
cli = Path(args.cli).resolve()
for name in ('supabase', 'supabase-go'):
    shutil.copy2(cli.parent / name, root / 'bin' / name)
# Downloads is protected for launchd. Keep the signing material local in
# an owner-only directory, independent of the checkout and Downloads folder.
original = Path(os.environ.get('FUELUP_APNS_CONFIG', Path.home()/'.config/fuelup/apns.json'))
credentials = json.loads(original.read_text())
signing_key = root/'apns.p8'
signing_key.touch(mode=0o600, exist_ok=True)
signing_key.chmod(0o600)
shutil.copyfile(credentials['keyPath'], signing_key)
credentials['keyPath'] = str(signing_key)
config_path = root/'apns.json'
config_path.touch(mode=0o600, exist_ok=True)
config_path.chmod(0o600)
config_path.write_text(json.dumps(credentials))
label = 'com.fuelup.price-alerts'
plist = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
plist.parent.mkdir(parents=True, exist_ok=True)
config = dict(Label=label, ProgramArguments=[node, str(root / 'scripts/price-alerts/worker.mjs')],
              WorkingDirectory=str(root), RunAtLoad=True, StartInterval=600, Umask=0o077,
              EnvironmentVariables=dict(FUELUP_APNS_CONFIG=str(config_path), HOME=str(Path.home()), PATH=os.pathsep.join([str(root/'bin'),str(Path(node).parent),'/usr/bin','/bin'])),
              StandardOutPath=str(root/'worker.log'), StandardErrorPath=str(root/'worker.log'))
with plist.open('wb') as f:
    plistlib.dump(config, f)
domain = 'gui/' + str(os.getuid())
subprocess.run(['launchctl','bootout',domain+'/'+label], stderr=subprocess.DEVNULL, check=False)
subprocess.run(['launchctl','bootstrap',domain,str(plist)], check=True)
