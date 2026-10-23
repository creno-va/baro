import com.android.apksig.ApkVerifier;
import java.io.File;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.HexFormat;
import java.util.TreeSet;

/** Runs with the installed Android SDK's apksigner.jar; emits no DN, key, path or exception stack. */
public class BaroApkCertificateProbe {
  public static void main(String[] args) {
    try {
      boolean fixture = args.length == 2 && args[0].equals("--fixture-api24");
      if (args.length != 1 && !fixture) throw new IllegalArgumentException();
      if (!fixture && args[0].equals("--self-test")) {
        new ApkVerifier.Builder(new File("unused-preflight.apk"));
        System.out.println("{\"version\":1,\"kind\":\"sdk-api-ready\"}");
        return;
      }
      ApkVerifier.Builder builder = new ApkVerifier.Builder(new File(args[fixture ? 1 : 0]));
      if (fixture) builder.setMinCheckedPlatformVersion(24);
      ApkVerifier.Result result = builder.build().verify();
      if (!result.isVerified()) throw new IllegalStateException();
      TreeSet<String> hashes = new TreeSet<>();
      for (X509Certificate certificate : result.getSignerCertificates()) {
        hashes.add(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())));
      }
      if (hashes.isEmpty()) throw new IllegalStateException();
      String kind = fixture ? "apk-fixture-verified-api24" : "apk-verified";
      StringBuilder output = new StringBuilder("{\"version\":1,\"kind\":\"" + kind + "\",\"certificateSha256\":[");
      for (String hash : hashes) {
        if (output.charAt(output.length() - 1) != '[') output.append(',');
        output.append('"').append(hash).append('"');
      }
      System.out.println(output.append("]}"));
    } catch (Exception failure) {
      System.err.println("ANDROID_SDK_SIGNATURE_PROBE_FAILED");
      System.exit(1);
    }
  }
}
