"""Push source using an ephemeral credential kept only in process memory."""
import getpass, os, subprocess, sys

remote=sys.argv[1]
token=getpass.getpass('Temporary repository credential: ')
env=os.environ.copy()
env.update({'GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'http.extraHeader','GIT_CONFIG_VALUE_0':'Authorization: Bearer '+token,'GIT_TERMINAL_PROMPT':'0'})
result=subprocess.run(['git','push',remote,'HEAD:main'],env=env,capture_output=True,text=True)
print(result.stdout.replace(token,'[REDACTED]'))
print(result.stderr.replace(token,'[REDACTED]'))
sys.exit(result.returncode)
