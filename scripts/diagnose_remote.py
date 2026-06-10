import paramiko
import time
from remote_credentials import load_ssh_password

# Configuration
HOST = "92.112.189.44"
PORT = 65002
USERNAME = "u795331143"
PASSWORD = load_ssh_password()
REMOTE_DIR = "/home/u795331143/domains/weotzi.com/public_html/beta"

def diagnose():
    try:
        print(f"Connecting to {HOST}:{PORT}...")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD)
        print("Connected successfully.")

        node_path = "/opt/alt/alt-nodejs22/root/usr/bin"
        node_bin = f"{node_path}/node"
        env_setup = f"export PATH={node_path}:$PATH && export PM2_HOME=/home/u795331143/.pm2"
        pm2_cmd = "./node_modules/.bin/pm2"

        commands = [
            f"{env_setup} && {node_bin} {pm2_cmd} list",
            f"{env_setup} && {node_bin} {pm2_cmd} logs weotzi-beta --lines 20 --nostream",
            "curl -v http://127.0.0.1:4545/ || echo 'Curl failed'",
            f"cat {REMOTE_DIR}/.htaccess",
            f"ls -la {REMOTE_DIR}"
        ]

        for cmd in commands:
            print(f"\n--- Executing: {cmd} ---")
            stdin, stdout, stderr = ssh.exec_command(f"cd {REMOTE_DIR} && {cmd}")
            
            # Wait for output
            exit_status = stdout.channel.recv_exit_status()
            out = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            
            if out:
                try:
                    print(f"[STDOUT]\n{out}")
                except UnicodeEncodeError:
                     print(f"[STDOUT] (encoding safe)\n{out.encode('ascii', 'ignore').decode()}")
            if err:
                try:
                    print(f"[STDERR]\n{err}")
                except UnicodeEncodeError:
                     print(f"[STDERR] (encoding safe)\n{err.encode('ascii', 'ignore').decode()}")
            
    except Exception as e:
        print(f"Diagnosis failed: {e}")
    finally:
        if 'ssh' in locals():
            ssh.close()

if __name__ == "__main__":
    diagnose()
