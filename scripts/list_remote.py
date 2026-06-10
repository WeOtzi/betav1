
import paramiko
import os
import sys
from remote_credentials import load_ssh_password

# Configuration
HOST = "92.112.189.44"
PORT = 65002
USERNAME = "u795331143"
PASSWORD = load_ssh_password()

def list_remote():
    try:
        # 1. Create SSH Client
        print(f"Connecting to {HOST}:{PORT}...")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD)
        print("Connected successfully.\n")

        # 2. List domains/weotzi.com/public_html/beta
        print("Checking beta/...")
        stdin, stdout, stderr = ssh.exec_command("ls -F domains/weotzi.com/public_html/beta/")
        
        # Wait for command to finish and get output
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        
        if out:
            print(f"--- Remote Beta ---\n{out}\n")
        if err:
            print(f"--- Remote Error ---\n{err}\n")
            
        if exit_status != 0:
            print(f"Command failed with exit status {exit_status}")

    except Exception as e:
        print(f"Connection failed: {e}")
    finally:
        if "ssh" in locals():
            ssh.close()

if __name__ == "__main__":
    list_remote()
