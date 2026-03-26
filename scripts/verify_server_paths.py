import paramiko

HOST = '92.112.189.44'
PORT = 65002
USERNAME = 'u795331143'
PASSWORD = 'Abnerisai24.'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD)

cmds = [
    'ls /home/u795331143/domains/weotzi.com/public_html/beta/',
    'ls /home/u795331143/domains/weotzi.com/public_html/beta/installer/ 2>/dev/null | head -20',
    'cat /home/u795331143/domains/weotzi.com/public_html/beta/installer/package.json 2>/dev/null | grep name',
    # Check PM2 or running process to confirm which dir the app runs from
    'pm2 list 2>/dev/null || echo "pm2 not in path"',
    'cat /etc/nginx/sites-enabled/* 2>/dev/null | grep root | head -5',
    'cat /home/u795331143/domains/weotzi.com/public_html/beta/ecosystem.config.js 2>/dev/null | head -10',
]

for cmd in cmds:
    print(f'\n$ {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd)
    print(stdout.read().decode().strip())
    err = stderr.read().decode().strip()
    if err:
        print('STDERR:', err[:200])

ssh.close()
