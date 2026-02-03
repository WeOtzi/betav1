import paramiko
import sys

# Configuration
HOST = "92.112.189.44"
PORT = 65002
USERNAME = "u795331143"
PASSWORD = "Abnerisai24."

def check_path():
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD)
        
        # Check standard alt-nodejs structure
        cmd = "ls -la /opt/alt/alt-nodejs20/root/bin/"
        print(f"Running: {cmd}")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        print(f"STDOUT: {stdout.read().decode().strip()}")
        print(f"STDERR: {stderr.read().decode().strip()}")
        
        # Also check where 'npm' is
        cmd = "ls -la /opt/alt/alt-nodejs20/root/usr/bin/" # Sometimes it's here
        print(f"Running: {cmd}")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        print(f"STDOUT: {stdout.read().decode().strip()}")

    finally:
        ssh.close()

if __name__ == "__main__":
    check_path()
